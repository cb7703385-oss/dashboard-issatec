import { GoogleGenAI, Type } from "@google/genai";
import type { ProcessedDataItem, AiAnalysisCardData, StrategicAiAnalysis } from '../types';

const MAX_TTS_PER_HOUR_SECONDS = 3540; // 59 minutes

function formatDataForPrompt(data: ProcessedDataItem[]): string {
    const criticalSlots = data
        .filter(item => item.noAtendidos > 0 || item.tasaAbandono > 0.1)
        .sort((a, b) => {
            if (a.sede < b.sede) return -1;
            if (a.sede > b.sede) return 1;
            return a.hora.localeCompare(b.hora);
        });

    if (criticalSlots.length === 0) {
        return "No se detectaron franjas horarias críticas. Todas las operaciones parecen estar dentro de la capacidad.";
    }

    // Limit to top 20 critical slots to avoid exceeding token limits
    const limitedSlots = criticalSlots.slice(0, 20);

    return limitedSlots.map(slot => {
        const ttsPromedioPorTurno = timeToSeconds(slot.tiempoServicio);
        // Usamos totalTurnos (que es el acumulado total de la hora) para el cálculo de demanda
        const ttsNecesarioSeg = slot.totalTurnos * ttsPromedioPorTurno;
        return `
- Sede: "${slot.sede}"
  Hora: "${slot.hora}"
  Fecha: "${slot.fecha}"
  Agentes Actuales: ${slot.agentes ?? 0}
  Turnos Totales de la Hora: ${slot.totalTurnos}
  Clientes No Atendidos: ${slot.noAtendidos}
  Tasa de Abandono: ${(slot.tasaAbandono * 100).toFixed(1)}%
  Espera Promedio Actual: ${slot.tiempoEspera}
  TTS Promedio por Turno: ${secondsToTime(ttsPromedioPorTurno)}
  TTS Total Actual: ${slot.tiempoTotalServicio}
  TTS por Agente Actual: ${secondsToTime(slot.tiempoPorAgente || 0)}
  TTS Requerido Total (Demanda Real): ${secondsToTime(ttsNecesarioSeg)}
  Agentes Óptimos (Cálculo sugerido): ${slot.agentesOptimos}
`;
    }).join('');
}


function timeToSeconds(timeStr: string): number {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length !== 3) return 0;
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
}

function secondsToTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return [hours, minutes, seconds].map(v => v.toString().padStart(2, '0')).join(':');
}

export const generateAnalysis = async (data: ProcessedDataItem[]): Promise<AiAnalysisCardData[]> => {
    // Client-side check for no critical slots to avoid unnecessary API call
    const hasCriticalSlots = data.some(item => item.noAtendidos > 0 || item.tasaAbandono > 0.1);
    if (!hasCriticalSlots) {
        return [];
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
    const formattedData = formatDataForPrompt(data);

    const prompt = `
        Como analista experto en operaciones para centros de servicio, analiza las siguientes franjas horarias críticas. 
        Para cada franja, proporciona un análisis conciso y tres recomendaciones claras y accionables: una de Eficiencia (A), una de Dotación (B) y una de Agentes Óptimos (C).

        Contexto:
        - "TTS" significa "Tiempo Total en Servicio".
        - El TTS operativo máximo por agente por hora es de ${secondsToTime(MAX_TTS_PER_HOUR_SECONDS)} (59 minutos).
        - "Turnos Acumulados" es la demanda total de la hora (nuevos turnos + pendientes de la hora anterior).
        - "Clientes No Atendidos" es el déficit de capacidad para la hora.
        - "Agentes Óptimos" es un cálculo pre-estimado basado en la demanda y un TTS por agente equilibrado.
        
        IMPORTANTE: 
        - El valor "TTS por Agente Actual" representa la **Productividad Real** de esa sede. Úsalo como referencia de ritmo de trabajo.
        - Todos los tiempos en tu análisis y recomendaciones deben estar en formato HH:MM:SS. NO uses segundos crudos.
        - **Simulación**: Para cada recomendación, DEBES incluir el objeto simulationParams con los valores numéricos específicos que estás proponiendo:
          - Opción A: incluir newProductivity (el nuevo TTS/agente sugerido, ej: "00:59:00").
          - Opción B: incluir newServiceTime (el nuevo tiempo de servicio promedio sugerido, ej: "00:08:00").
          - Opción C: incluir newAgents (el número total de agentes sugerido, ej: 44).
        
        Tu respuesta DEBE incluir exactamente TRES recomendaciones por franja horaria:
        1. Opción A (efficiency): "Optimización de Productividad Actual". Calcular cuánto mejoraría la **Espera Promedio** si se aumenta la productividad individual.
        2. Opción B (staffing): "Optimización de Tiempo de Servicio". Proyectar la reducción drástica en la **Espera Promedio** al agilizar el servicio promedio de atención.
        3. Opción C (optimal): "Agentes Óptimos Sugeridos Manteniendo Productividad". Indicar que con esta dotación la **Espera Promedio** bajará a niveles óptimos o cercanos a cero, eliminando el déficit.
        
        IMPORTANTE: Cada recomendación debe mencionar explícitamente el impacto esperado en la "Espera Promedio".
        
        Datos a analizar:
        ${formattedData}

        Tu respuesta DEBE ser un array JSON. Cada objeto en el array representa una franja horaria crítica y debe seguir este esquema exacto. No añadas ningún texto extra ni formato markdown antes o después del array JSON.
    `;

    const responseSchema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                sede: { type: Type.STRING },
                hora: { type: Type.STRING },
                fecha: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ['CRITICAL', 'WARNING', 'INFO'] },
                title: { type: Type.STRING, description: "Un título corto e impactante para el problema (ej., 'CRÍTICO: Déficit de Capacidad')." },
                summary: { type: Type.STRING, description: "Un breve resumen de una oración sobre el problema central." },
                recommendations: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            type: { type: Type.STRING, enum: ['efficiency', 'staffing', 'optimal'] },
                            title: { type: Type.STRING, description: "Título para la recomendación, ej., 'Opción A: Mejorar Productividad' o 'Opción C: Agentes Óptimos'." },
                            description: { type: Type.STRING, description: "La acción específica a tomar, incluyendo números. Ej., 'Mantener X agentes y aumentar el TTS/agente a HH:MM:SS'." },
                            details: { type: Type.STRING, description: "Opcional: detalle de apoyo, ej., 'TTS total requerido: HH:MM:SS'." },
                            simulationParams: {
                                type: Type.OBJECT,
                                properties: {
                                    newAgents: { type: Type.NUMBER },
                                    newServiceTime: { type: Type.STRING },
                                    newProductivity: { type: Type.STRING }
                                }
                            }
                        },
                        required: ["type", "title", "description"]
                    }
                }
            },
            required: ["sede", "hora", "fecha", "severity", "title", "summary", "recommendations"]
        }
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });

        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText);
        return result as AiAnalysisCardData[];

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error("No se pudo obtener el análisis de la API de Gemini.");
    }
};

export const generateStrategicAnalysis = async (data: ProcessedDataItem[]): Promise<StrategicAiAnalysis> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

    // Aggregating hourly data for the daily view
    const hourlyData = [...data].sort((a, b) => a.hora.localeCompare(b.hora));

    const formattedDailyData = hourlyData.map(slot => `
- Hora: ${slot.hora}
  Agentes: ${slot.agentes ?? 0}
  Óptimos: ${slot.agentesOptimos}
  Turnos Totales: ${slot.totalTurnos}
  Acumulados: ${slot.totalTurnosConPendientes} (incl. pendientes)
  No Atendidos: ${slot.noAtendidos}
  Tasa Abandono: ${(slot.tasaAbandono * 100).toFixed(1)}%
  TTS Total: ${slot.tiempoTotalServicio}
`).join('');

    const prompt = `
        Actúa como un Director de Operaciones (COO) experto en optimización de Centros de Contacto. 
        Analiza el flujo de demanda y capacidad de TODO EL DÍA.
        
        Datos de la Jornada para analizar:
        ${formattedDailyData}

        IMPORTANTE: 
        1. Tu análisis debe ser holístico. Mira cómo el déficit de agentes de 06:00 a 10:00 genera el "efecto bola de nieve" de turnos acumulados.
        2. Proporciona una tabla de 'Escenario Propuesto' basada en **'Agentes Óptimos Sugeridos Manteniendo Productividad'**.
        3. Incluye una sección sobre la sensibilidad del Tiempo de Servicio: explica cómo una reducción en los minutos promedio de atención impactaría positivamente en la reducción de agentes necesarios.
        4. Identifica periodos de capacidad ociosa y sugiere reajustes.
        5. Todos los tiempos deben estar en HH:MM:SS.
        
        Tu respuesta DEBE ser un objeto JSON que siga exactamente este esquema:
        {
          "globalSummary": "string",
          "dailyTrendAnalysis": "string",
          "proposedScenario": [{"hour": "string", "currentAgents": number, "suggestedAgents": number, "expectedImpact": "string"}],
          "operationalSchedule": [{"activity": "string", "recommendedTimeSlots": ["string"], "rationale": "string"}],
          "agentEfficiencyAnalysis": "string"
        }
    `;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            globalSummary: { type: Type.STRING },
            dailyTrendAnalysis: { type: Type.STRING },
            proposedScenario: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        hour: { type: Type.STRING },
                        currentAgents: { type: Type.NUMBER },
                        suggestedAgents: { type: Type.NUMBER },
                        expectedImpact: { type: Type.STRING }
                    },
                    required: ["hour", "currentAgents", "suggestedAgents", "expectedImpact"]
                }
            },
            operationalSchedule: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        activity: { type: Type.STRING },
                        recommendedTimeSlots: { type: Type.ARRAY, items: { type: Type.STRING } },
                        rationale: { type: Type.STRING }
                    },
                    required: ["activity", "recommendedTimeSlots", "rationale"]
                }
            },
            agentEfficiencyAnalysis: { type: Type.STRING }
        },
        required: ["globalSummary", "dailyTrendAnalysis", "proposedScenario", "operationalSchedule", "agentEfficiencyAnalysis"]
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });

        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as StrategicAiAnalysis;

    } catch (error) {
        console.error("Error in strategic analysis:", error);
        throw new Error("No se pudo generar el análisis estratégico.");
    }
};