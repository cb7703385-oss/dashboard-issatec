
import type { RawDataItem, ProcessedDataItem, Stats, AiAnalysisCardData } from '../types';

export function timeToSeconds(timeStr: string): number {
    if (!timeStr || typeof timeStr !== 'string' || timeStr === "00:00:00") return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length !== 3) return 0;
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
}

export function secondsToTime(seconds: number): string {
    if (seconds <= 0 || !seconds) return "00:00:00";
    const totalSeconds = Math.round(seconds);
    const horas = Math.floor(totalSeconds / 3600);
    const minutos = Math.floor((totalSeconds % 3600) / 60);
    const segundos = totalSeconds % 60;
    return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`;
}

export function formatNumberWithCommas(number: number): string {
    if (number === undefined || number === null) return "0";
    return Math.round(number).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function calculateStats(data: ProcessedDataItem[]): Stats {
    const totalTurnos = data.reduce((sum, item) => sum + item.totalTurnos, 0);
    const totalAtendidos = data.reduce((sum, item) => sum + item.atendidos, 0);
    const totalAbandonados = data.reduce((sum, item) => sum + item.abandonados, 0);
    const tasaAbandono = totalTurnos > 0 ? (totalAbandonados / totalTurnos) * 100 : 0;

    let sumaEspera = 0; let sumaServicio = 0; let countEspera = 0; let countServicio = 0;
    let sumaAgentes = 0; let countAgentes = 0; let sumaTiempoPorAgente = 0; let countTiempoPorAgente = 0;
    let sumaTotalServicio = 0;

    data.forEach(item => {
        sumaEspera += timeToSeconds(item.tiempoEspera); countEspera++;
        sumaServicio += timeToSeconds(item.tiempoServicio); countServicio++;
        if (item.agentes) { sumaAgentes += item.agentes; countAgentes++; }
        if (item.tiempoPorAgente) { sumaTiempoPorAgente += item.tiempoPorAgente; countTiempoPorAgente++; }
        sumaTotalServicio += timeToSeconds(item.tiempoTotalServicio);
    });

    return {
        totalTurnos, totalAtendidos, totalAbandonados, tasaAbandono,
        promedioTiempoEspera: secondsToTime(countEspera > 0 ? sumaEspera / countEspera : 0),
        promedioTiempoServicio: secondsToTime(countServicio > 0 ? sumaServicio / countServicio : 0),
        totalAgentes: countAgentes > 0 ? Math.round(sumaAgentes / countAgentes) : 0,
        promedioTiempoPorAgente: secondsToTime(countTiempoPorAgente > 0 ? sumaTiempoPorAgente / countTiempoPorAgente : 0),
        totalTiempoServicio: secondsToTime(sumaTotalServicio)
    };
}

export function processRawData(data: (RawDataItem | ProcessedDataItem)[], specificDate?: string, specificSede?: string): ProcessedDataItem[] {
    const processedItems: ProcessedDataItem[] = [];
    const groupedByDateSede: { [key: string]: (RawDataItem | ProcessedDataItem)[] } = {};

    data.forEach(item => {
        const key = `${item.fecha}|${item.sede}`;
        if (!groupedByDateSede[key]) groupedByDateSede[key] = [];
        groupedByDateSede[key].push(item);
    });

    const processGroup = (items: (RawDataItem | ProcessedDataItem)[]) => {
        const hourlyGroups: { [key: string]: (RawDataItem | ProcessedDataItem)[] } = {};
        items.forEach(item => {
            if (!hourlyGroups[item.hora]) hourlyGroups[item.hora] = [];
            hourlyGroups[item.hora].push(item);
        });

        const sortedHours = Object.keys(hourlyGroups).sort();
        let acumuladoPendientes = 0;
        let baselineAcumuladoPendientes = 0;
        let isSimulatingGroup = false;

        for (const hour of sortedHours) {
            const hourItems = hourlyGroups[hour];
            let totalArrivals = 0;
            let totalAbandonados = 0;
            let maxAgentesUnit = 0;
            let baselineTTS_Seg = 0;
            let sumaT_Serv_Baseline = 0;
            let sumaT_Wait_Baseline = 0;
            let countT_Baseline = 0;

            hourItems.forEach(item => {
                const p = item as ProcessedDataItem;
                totalArrivals += Number(item.totalTurnos) || 0;
                totalAbandonados += Number(item.abandonados) || 0;
                maxAgentesUnit = Math.max(maxAgentesUnit, Number(item.agentes) || 0);

                const originalTTS = p.originalTiempoTotalServicio ? timeToSeconds(p.originalTiempoTotalServicio) : timeToSeconds(item.tiempoTotalServicio);
                baselineTTS_Seg += originalTTS;

                const originalTS = p.originalTiempoServicio ? timeToSeconds(p.originalTiempoServicio) : timeToSeconds(item.tiempoServicio);
                const originalTW = p.originalTiempoEspera ? timeToSeconds(p.originalTiempoEspera) : timeToSeconds(item.tiempoEspera);

                sumaT_Serv_Baseline += originalTS;
                sumaT_Wait_Baseline += originalTW;
                countT_Baseline++;
            });

            const baselineAvgServTime = countT_Baseline > 0 ? sumaT_Serv_Baseline / countT_Baseline : 0;
            const baselineAvgWaitTime = countT_Baseline > 0 ? sumaT_Wait_Baseline / countT_Baseline : 0;
            const baselineProductivity = maxAgentesUnit > 0 ? baselineTTS_Seg / maxAgentesUnit : 0;

            const baselineCapacity = baselineAvgServTime > 0 ? Math.floor((maxAgentesUnit * baselineProductivity) / baselineAvgServTime) : 0;
            const baselineTotalDemand = totalArrivals + baselineAcumuladoPendientes;
            const baselineAtendidosReal = Math.min(baselineCapacity, Math.max(0, baselineTotalDemand - totalAbandonados));
            const hourEndingBaselineBacklog = Math.max(0, baselineTotalDemand - baselineAtendidosReal - totalAbandonados);

            // Check if this hour or any previous hour in this group has been edited
            const editedItem = hourItems.find(it => (it as ProcessedDataItem).isEdited);
            if (editedItem) isSimulatingGroup = true;

            // Determine Effective Parameters
            let effectiveProductivity = baselineProductivity;
            let effectiveAgents = maxAgentesUnit;
            let effectiveAvgServTime = baselineAvgServTime;

            if (editedItem) {
                const ep = editedItem as ProcessedDataItem;
                effectiveProductivity = ep.tiempoPorAgente || baselineProductivity;
                effectiveAgents = ep.agentes || maxAgentesUnit;
                effectiveAvgServTime = timeToSeconds(ep.tiempoServicio) || baselineAvgServTime;
            }

            let capacityLimit = 0;
            if (effectiveAvgServTime > 0) {
                capacityLimit = Math.floor((effectiveAgents * effectiveProductivity) / effectiveAvgServTime);
            }

            const totalDemand = totalArrivals + acumuladoPendientes;
            const netDemandToServe = Math.max(0, totalDemand - totalAbandonados);
            const simulatedAtendidosReal = Math.min(capacityLimit, netDemandToServe);
            const hourEndingBacklog = Math.max(0, totalDemand - simulatedAtendidosReal - totalAbandonados);

            let waitTimeRatio = 1.0;
            if (baselineTotalDemand > 0 && baselineCapacity > 0) {
                waitTimeRatio = (totalDemand / baselineTotalDemand) * (baselineCapacity / Math.max(1, capacityLimit));
            }
            const simulatedAvgWaitTime = baselineAvgWaitTime * waitTimeRatio;

            hourItems.forEach(item => {
                const res = item as ProcessedDataItem;

                if (!res.originalTiempoTotalServicio) res.originalTiempoTotalServicio = res.tiempoTotalServicio;
                if (res.originalTiempoPorAgente === undefined) res.originalTiempoPorAgente = baselineProductivity;
                if (!res.originalTiempoServicio) res.originalTiempoServicio = res.tiempoServicio;
                if (!res.originalTiempoEspera) res.originalTiempoEspera = res.tiempoEspera;
                if (res.originalAgentes === undefined) res.originalAgentes = Number(item.agentes) || 0;

                res.totalTurnos = Number(item.totalTurnos) || 0;
                res.agentes = Number(effectiveAgents) || 0;
                res.tiempoPorAgente = Number(effectiveProductivity) || 0;
                res.tiempoServicio = secondsToTime(effectiveAvgServTime);
                res.tiempoEspera = secondsToTime(simulatedAvgWaitTime);

                const share = totalArrivals > 0 ? res.totalTurnos / totalArrivals : 1;
                const currentNetArrivals = Math.max(0, res.totalTurnos - (Number(item.abandonados) || 0));
                res.atendidos = Math.min(currentNetArrivals, Math.round(capacityLimit * share));
                res.capacidadEstimada = Math.round(capacityLimit * share);
                res.noAtendidos = Math.max(0, res.totalTurnos - res.atendidos - (Number(item.abandonados) || 0));

                res.acumulacion = hourEndingBacklog;
                res.totalTurnosConPendientes = totalDemand;
                res.tiempoTotalServicio = secondsToTime(Math.min(capacityLimit * share, netDemandToServe * share) * effectiveAvgServTime);

                res.agentesOptimos = effectiveAvgServTime > 0 ? Math.ceil((totalDemand * effectiveAvgServTime) / (res.tiempoPorAgente || 3600)) : 0;
                res.isEdited = isSimulatingGroup;
                res.tasaAbandono = res.totalTurnos > 0 ? (Number(item.abandonados) || 0) / res.totalTurnos : 0;

                processedItems.push(res);
            });

            acumuladoPendientes = hourEndingBacklog;
            baselineAcumuladoPendientes = hourEndingBaselineBacklog;
        }
    };

    if (specificDate && specificSede) {
        const reprocessKey = `${specificDate}|${specificSede}`;
        Object.entries(groupedByDateSede).forEach(([key, items]) => {
            if (key === reprocessKey) processGroup(items);
            else processedItems.push(...(items as ProcessedDataItem[]));
        });
        const keyMap = new Map(data.map((item, index) => [`${item.fecha}|${item.sede}|${item.hora}`, index]));
        processedItems.sort((a, b) => (keyMap.get(`${a.fecha}|${a.sede}|${a.hora}`) ?? 0) - (keyMap.get(`${b.fecha}|${b.sede}|${b.hora}`) ?? 0));
    } else {
        Object.values(groupedByDateSede).forEach(processGroup);
    }
    return processedItems;
}

export function runScenarioSimulation(
    originalData: ProcessedDataItem[],
    targetHour: string,
    params: { newAgents?: number, newServiceTime?: string, newProductivity?: string }
): ProcessedDataItem[] {
    const sortedData = [...originalData].sort((a, b) => a.hora.localeCompare(b.hora));
    const simulatedData: ProcessedDataItem[] = [];
    let cumulativePending = 0;
    let baselineCumulativePending = 0;

    const targetIdx = sortedData.findIndex(item => item.hora === targetHour);
    if (targetIdx > 0) {
        cumulativePending = sortedData[targetIdx - 1].acumulacion || 0;
        baselineCumulativePending = cumulativePending;
    }

    const newServiceTimeSec = params.newServiceTime ? timeToSeconds(params.newServiceTime) : 0;
    const newProductivitySec = params.newProductivity ? timeToSeconds(params.newProductivity) : 0;

    sortedData.forEach(item => {
        if (item.hora < targetHour) {
            simulatedData.push({ ...item });
            cumulativePending = item.acumulacion || 0;
            baselineCumulativePending = item.acumulacion || 0;
            return;
        }

        const arrivals = item.totalTurnos;
        const totalDemand = arrivals + cumulativePending;

        const baseWaitSec = timeToSeconds(item.originalTiempoEspera || item.tiempoEspera);
        const baseServSec = timeToSeconds(item.originalTiempoServicio || item.tiempoServicio);
        const originalProductivity = item.originalTiempoPorAgente || item.tiempoPorAgente || 3600;
        const originalAgents = item.originalAgentes !== undefined ? item.originalAgentes : (item.agentes || 1);
        const baseCapacity = baseServSec > 0 ? Math.floor((originalAgents * originalProductivity) / baseServSec) : 0;
        const baseTotalDemand = arrivals + baselineCumulativePending;

        const productivity = (newProductivitySec > 0) ? newProductivitySec : (item.tiempoPorAgente || 0);
        const serviceTime = (newServiceTimeSec > 0) ? newServiceTimeSec : timeToSeconds(item.tiempoServicio);
        let agents = item.agentes || 0;

        if (item.hora === targetHour && params.newAgents !== undefined) {
            agents = params.newAgents;
        } else if (params.newAgents !== undefined) {
            agents = Math.max(1, Math.ceil((totalDemand * serviceTime) / productivity));
        }

        const capacity = serviceTime > 0 ? Math.floor((agents * productivity) / serviceTime) : 0;
        const netArrivals = Math.max(0, arrivals - item.abandonados);
        const totalNetDemand = Math.max(0, totalDemand - item.abandonados);

        const totalAttended = Math.min(capacity, totalNetDemand);
        const attendedFromArrivals = Math.min(netArrivals, capacity);
        const newPending = Math.max(0, totalDemand - totalAttended - item.abandonados);

        let waitTimeRatio = 1.0;
        if (baseTotalDemand > 0 && baseCapacity > 0) {
            waitTimeRatio = (totalDemand / baseTotalDemand) * (baseCapacity / Math.max(1, capacity));
        }

        simulatedData.push({
            ...item,
            agentes: agents,
            atendidos: attendedFromArrivals,
            capacidadEstimada: capacity,
            noAtendidos: Math.max(0, arrivals - (attendedFromArrivals + item.abandonados)),
            acumulacion: newPending,
            totalTurnosConPendientes: totalDemand,
            tiempoServicio: secondsToTime(serviceTime),
            tiempoEspera: secondsToTime(baseWaitSec * waitTimeRatio),
            tiempoTotalServicio: secondsToTime(totalAttended * serviceTime),
            tiempoPorAgente: productivity,
            isEdited: true
        });

        cumulativePending = newPending;

        const baseAtended = Math.min(baseCapacity, Math.max(0, baseTotalDemand - item.abandonados));
        baselineCumulativePending = Math.max(0, baseTotalDemand - baseAtended - item.abandonados);
    });
    return simulatedData;
}
