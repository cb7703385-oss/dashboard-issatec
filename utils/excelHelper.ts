import type { ProcessedDataItem } from '../types';
import { secondsToTime } from './dataProcessor';

export function downloadExcel(data: ProcessedDataItem[], fileName: string) {
    if (data.length === 0) {
        console.warn('No hay datos filtrados para descargar');
        return;
    }

    try {
        const ws_data: (string | number | null)[][] = [];
        ws_data.push([
            'Fecha', 'Sede', 'Horario', 'Total Turnos', 'Tasa Abandono (%)',
            'Tiempo Espera Prom.', 'Tiempo Servicio Prom.', 'Tiempo Total en Servicio (HH:MM:SS)',
            'Agentes Actuales', 'Tiempo Total en Servicio por Agente (seg)', 'Tiempo Total en Servicio por Agente (HH:MM:SS)',
            'Capacidad Estimada', 'Clientes No Atendidos', 'Turnos Acumulados', 'Agentes Óptimos'
        ]);

        data.forEach(item => {
            ws_data.push([
                item.fecha, item.sede, item.hora, item.totalTurnos,
                (item.tasaAbandono * 100).toFixed(1), item.tiempoEspera, item.tiempoServicio,
                item.tiempoTotalServicio, item.agentes ?? 'N/A', item.tiempoPorAgente,
                secondsToTime(item.tiempoPorAgente), item.capacidadEstimada,
                item.noAtendidos, item.totalTurnosConPendientes, item.agentesOptimos
            ]);
        });

        const ws = (window as any).XLSX.utils.aoa_to_sheet(ws_data);
        const colWidths = [
            { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 18 },
            { wch: 20 }, { wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 35 },
            { wch: 30 }, { wch: 18 }, { wch: 22 }, { wch: 20 }, { wch: 15 }
        ];
        ws['!cols'] = colWidths;
        
        const wb = (window as any).XLSX.utils.book_new();
        (window as any).XLSX.utils.book_append_sheet(wb, ws, "Datos_Filtrados");
        (window as any).XLSX.writeFile(wb, fileName);
    } catch (error) {
        console.error('Error al generar el archivo Excel:', error);
        alert('Ocurrió un error al generar el archivo Excel.');
    }
}