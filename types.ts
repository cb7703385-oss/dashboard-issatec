
export interface RawDataItem {
    sede: string;
    hora: string;
    fecha: string;
    tiempoServicio: string;
    tiempoEspera: string;
    totalTurnos: number;
    atendidos: number;
    abandonados: number;
    tasaAbandono: number;
    tiempoTotalServicio: string;
    agentes: number | null;
    isEdited?: boolean;
    servicio?: string;
    turnosAtendidosReales?: number;
    waitingTimeWarning?: number;
    waitingTimeCritical?: number;
    serviceTimeWarning?: number;
    serviceTimeCritical?: number;
}

export interface ProcessedDataItem extends RawDataItem {
    totalTurnosConPendientes: number;
    capacidadEstimada: number;
    noAtendidos: number;
    agentesOptimos: number;
    acumulacion: number;
    tiempoPorAgente: number; // in seconds
    originalTiempoTotalServicio: string;
    originalTiempoPorAgente: number;
    originalTiempoServicio: string;
    originalTiempoEspera: string;
    originalAgentes: number;
    isEdited: boolean;
    servicio?: string;
}

export interface Stats {
    totalTurnos: number;
    totalAtendidos: number;
    totalAbandonados: number;
    tasaAbandono: number;
    promedioTiempoEspera: string;
    promedioTiempoServicio: string;
    totalAgentes: number;
    promedioTiempoPorAgente: string;
    totalTiempoServicio: string;
    waitingTimeWarning?: number;
    waitingTimeCritical?: number;
    serviceTimeWarning?: number;
    serviceTimeCritical?: number;
    totalAgentesGlobal?: number;
}

export interface AiAnalysisCardData {
    sede: string;
    hora: string;
    fecha: string;
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
    title: string;
    summary: string;
    recommendations: {
        type: 'efficiency' | 'staffing' | 'optimal';
        title: string;
        description: string;
        details?: string;
        simulationParams?: {
            newAgents?: number;
            newServiceTime?: string;
            newProductivity?: string;
        };
    }[];
}

export interface StrategicAiAnalysis {
    globalSummary: string;
    dailyTrendAnalysis: string;
    proposedScenario: {
        hour: string;
        currentAgents: number;
        suggestedAgents: number;
        expectedImpact: string;
    }[];
    operationalSchedule: {
        activity: string;
        recommendedTimeSlots: string[];
        rationale: string;
    }[];
    agentEfficiencyAnalysis: string;
}

export interface ServiceDataItem {
    servicio: string;
    fecha: string;
    hora: string;
    tiempoServicio: string;
    tiempoEspera: string;
    totalTurnos: number;
    atendidos: number;
    abandonados: number;
    tasaAbandono: number;
    tiempoTotalServicio: string;
    ttsPorAgente: string;
    agentes: number | null;
    turnosAtendidosReales: number;
    noAtendidos: number;
    totalTurnosConPendientes: number;
    agentesOptimos: number;
    acumulacion: number;
}

export interface ProjectionData {
    hora: number;
    servicio: string;
    nombre_unidad: string;
    turnos_proyectados: number;
    tiempo_prom_servicio_seg: number;
    asesores_sugeridos_hora: number;
    fecha_proyeccion: any;
    agentes_optimos_dia: number;
    agentes_contratos_8h: number;
}

export interface LiveDataItem {
    Oficina: string;
    Servicio: string;
    Hora_Minuto: string;
    Segundos_Espera: number;
    Segundos_Servicio: number;
    Atendidos: number;
    Abandonos: number;
    Total_Turnos: number;
    Espera_Etiqueta: string;
    Servicio_Etiqueta: string;
    Espera_Warning_Segs: number;
    Espera_Critical_Segs: number;
    Servicio_Warning_Segs: number;
    Servicio_Critical_Segs: number;
}
