import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { formatNumberWithCommas } from './dataProcessor';

interface ReportData {
    clientName: string;
    currentDate: string;
    previousDate: string;
    avgWaitTime?: string;
    prevAvgWaitTime?: string;
    varWaitTime?: number;
    avgServTime?: string;
    prevAvgServTime?: string;
    varServTime?: number;
    units: {
        unidad: string;
        current: any;
        previous: any;
        changes: any;
    }[];
    units30d?: {
        unidad: string;
        current: any;
        previous: any;
        changes: any;
    }[];
    trendHistory?: any[];
    fullUnitHistory?: any[];
}

// Helpers
const cleanInvisibleChars = (text: string): string => {
    if (!text) return '';
    return text
        // Zero width chars
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // RTL / LTR marks
        .replace(/[\u200E\u200F]/g, '')
        // espacios múltiples
        .replace(/\s+/g, ' ')
        .trim();
};

const fmtUnitName = (name: string) => {
    if (!name) return '';
    let clean = cleanInvisibleChars(name);
    clean = clean.replace(/^>\s*/, '').trim();
    clean = clean.replace(/^Pd-/i, '');
    const noHyphens = clean.replace(/-/g, ' ');
    return noHyphens.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
};

const loadImage = async (src: string): Promise<HTMLImageElement | null> => {
    const img = new Image();
    img.src = src;
    await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = () => resolve(null);
    });
    return img.complete && img.naturalWidth > 0 ? img : null;
};

const drawAlertText = (doc: jsPDF, text: string, x: number, y: number): number => {
    const content = cleanInvisibleChars(text.replace(/^•\s*/, ''));
    const boxWidth = 170;

    (doc as any).autoTable({
        startY: y,
        margin: { left: x },
        tableWidth: boxWidth,
        body: [[content]],
        theme: 'plain',
        styles: {
            font: 'helvetica',
            fontSize: 9,
            textColor: [220, 38, 38],
            cellPadding: 4,
            valign: 'top'
        },
        bodyStyles: {
            fillColor: [255, 245, 245],
            lineColor: [220, 38, 38],
            lineWidth: 0.3
        },
        columnStyles: {
            0: { cellWidth: boxWidth }
        }
    });

    return (doc as any).lastAutoTable.finalY + 4;
};

const analyzeAndRenderHistoryAlerts = (doc: jsPDF, fullHistory: any[], y: number): number => {
    if (!fullHistory || fullHistory.length === 0) return y;

    let currentY = y;
    const units = [...new Set(fullHistory.map(h => h.unidad))];
    const unitStats = units.map(u => {
        const h = fullHistory.filter(x => x.unidad === u).sort((a, b) => a.fecha.localeCompare(b.fecha));
        return {
            unidad: u,
            history: h,
            totalDays: h.length,
            daysWithTurns: h.filter(x => x.totalTurnos > 0).length,
            activeDates: h.filter(x => x.totalTurnos > 0).map(x => x.fecha.split('-').reverse().join('/')),
            avgAtendidos: h.reduce((acc, x) => acc + x.atendidos, 0) / h.length,
            avgWaitSecs: h.reduce((acc, x) => acc + (x.tiempoEspera ? x.tiempoEspera.split(':').reduce((a: any, b: any) => (a * 60) + +b, 0) : 0), 0) / h.length,
            avgServSecs: h.reduce((acc, x) => acc + (x.tiempoServicio ? x.tiempoServicio.split(':').reduce((a: any, b: any) => (a * 60) + +b, 0) : 0), 0) / h.length
        };
    });

    const categories = [
        { label: 'Uso Discontinuo del Sistema (No se usó todos los días registrados)', key: 'inactividad' },
        { label: 'Picos de Abandono', key: 'alto_abandono' }
    ];

    categories.forEach(cat => {
        const events: string[] = [];

        unitStats.forEach(u => {
            if (cat.key === 'inactividad') {
                if (u.daysWithTurns < u.totalDays) {
                    events.push(`${fmtUnitName(u.unidad)}: Registró uso solo los días ${u.activeDates.join(', ')}`);
                }
                return;
            }

            u.history.forEach(day => {
                const dayLabel = day.fecha.split('-').reverse().join('/');
                const waitSecs = day.tiempoEspera ? day.tiempoEspera.split(':').reduce((a: any, b: any) => (a * 60) + +b, 0) : 0;
                const servSecs = day.tiempoServicio ? day.tiempoServicio.split(':').reduce((a: any, b: any) => (a * 60) + +b, 0) : 0;

                if (cat.key === 'alto_abandono' && (day.abandonos > 5 || (day.totalTurnos > 0 && day.abandonos / day.totalTurnos > 0.2))) {
                    const pct = day.totalTurnos > 0 ? (day.abandonos / day.totalTurnos * 100).toFixed(1) : 0;
                    events.push(`${fmtUnitName(u.unidad)}: ${dayLabel} (${day.abandonos} abandonos - ${pct}%)`);
                }
            });
        });

        if (events.length > 0) {
            if (currentY > 250) { doc.addPage(); currentY = 20; }
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(37, 99, 235);
            doc.text(`• ${cat.label}`, 15, currentY);
            currentY += 5;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(50, 50, 50);

            // Agrupar e de forma segura
            const grouped = events.reduce((acc: any, e) => {
                const parts = e.split(': ');
                const uname = parts[0];
                const detail = parts.slice(1).join(': ');
                if (!acc[uname]) acc[uname] = [];
                acc[uname].push(detail);
                return acc;
            }, {});

            Object.keys(grouped).forEach(uname => {
                const text = `${uname}: ${grouped[uname].join('; ')}.`;
                const lines = doc.splitTextToSize(text, 170);
                lines.forEach((line: string) => {
                    if (currentY > 275) { doc.addPage(); currentY = 20; }
                    doc.text(line, 20, currentY);
                    currentY += 4;
                });
            });
            currentY += 3;
        }
    });

    return currentY;
};

const renderAlertsList = (doc: jsPDF, unitsList: any[], alertY: number, titlePrefix: string = '', primaryColor: number[]): number => {
    if (!unitsList || unitsList.length === 0) return alertY;

    let currentY = alertY;

    if (titlePrefix) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.text(titlePrefix, 15, currentY);
        currentY += 6;
        doc.setFont('helvetica', 'normal');
    }

    doc.setFontSize(9);

    // 1. Unidades sin uso (solo para diario o si tiene sentido)
    if (!titlePrefix) {
        const inactive = unitsList.filter(u => u.current.totalTurnos === 0 && u.previous.totalTurnos > 0);
        if (inactive.length > 0) {
            const list = inactive.map(u => fmtUnitName(u.unidad)).join(', ');
            doc.setTextColor(220, 38, 38);
            const text = '• ' + inactive.length + ' unidades no usaron el sistema hoy: ' + list + '.';
            currentY = drawAlertText(doc, text, 20, currentY);
        }
    }

    // 2. Disminuyeron Turnos
    const decreasedTurnos = unitsList.filter(u => u.changes.turnos <= -0.1 && u.current.totalTurnos > 0);
    if (decreasedTurnos.length > 0) {
        const list = decreasedTurnos.map(u => fmtUnitName(u.unidad)).join(', ');
        doc.setTextColor(220, 38, 38);
        const text = '• ' + decreasedTurnos.length + ' unidades disminuyeron Turnos: ' + list + '.';
        currentY = drawAlertText(doc, text, 20, currentY);
    }

    // 3. Disminuyeron Atendidos
    const decreasedAtendidos = unitsList.filter(u => u.changes.atendidos <= -0.1 && u.current.atendidos > 0);
    if (decreasedAtendidos.length > 0) {
        const list = decreasedAtendidos.map(u => fmtUnitName(u.unidad)).join(', ');
        doc.setTextColor(220, 38, 38);
        const text = '• ' + decreasedAtendidos.length + ' unidades disminuyeron Atendidos: ' + list + '.';
        currentY = drawAlertText(doc, text, 20, currentY);
    }

    // 4. Aumentaron Abandonos
    const increasedAbandonos = unitsList.filter(u => u.changes.abandonos >= 0.1);
    if (increasedAbandonos.length > 0) {
        const list = increasedAbandonos.map(u => fmtUnitName(u.unidad)).join(', ');
        doc.setTextColor(220, 38, 38);
        const text = '• ' + increasedAbandonos.length + ' unidades aumentaron Abandonos: ' + list + '.';
        currentY = drawAlertText(doc, text, 20, currentY);
    }

    // 5. Aumentaron Tiempo Prom. Espera
    const increasedEspera = unitsList.filter(u => u.changes.espera >= 0.1);
    if (increasedEspera.length > 0) {
        const list = increasedEspera.map(u => fmtUnitName(u.unidad)).join(', ');
        doc.setTextColor(220, 38, 38);
        const text = '• ' + increasedEspera.length + ' unidades aumentaron Tiempo Prom. Espera: ' + list + '.';
        currentY = drawAlertText(doc, text, 20, currentY);
    }

    // 6. Aumentaron Tiempo Prom. Servicio
    const increasedServicio = unitsList.filter(u => u.changes.servicio >= 0.1);
    if (increasedServicio.length > 0) {
        const list = increasedServicio.map(u => fmtUnitName(u.unidad)).join(', ');
        doc.setTextColor(220, 38, 38);
        const text = '• ' + increasedServicio.length + ' unidades aumentaron Tiempo Prom. Servicio: ' + list + '.';
        currentY = drawAlertText(doc, text, 20, currentY);
    }

    return currentY + 4;
};

const drawLineChart = (doc: jsPDF, data: number[], labels: string[], title: string, x: number, y: number, width: number, height: number, color: number[]) => {
    if (!data.length) return;

    // Fondo de la tarjeta
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(230, 231, 235);
    (doc as any).roundedRect(x - 2, y - 8, width + 4, height + 18, 2, 2, 'FD');

    // Título
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(title, x, y - 2);

    // Escalar datos
    const max = Math.max(...data, 1);
    const min = Math.min(...data);
    const padding = (max - min) * 0.1 || 1;
    const chartMax = max + padding;
    const chartMin = Math.max(0, min - padding);
    const range = chartMax - chartMin;

    const getX = (i: number) => x + (i * (width / (data.length - 1)));
    const getY = (val: number) => y + height - ((val - chartMin) / range * height);

    // Grid horizontal (3 líneas)
    doc.setLineWidth(0.05);
    doc.setDrawColor(240, 240, 240);
    [0, 0.5, 1].forEach(p => {
        const gy = y + height * p;
        doc.line(x, gy, x + width, gy);
    });

    // Línea de sombra (Efecto premium)
    doc.setLineWidth(1.2);
    doc.setDrawColor(color[0], color[1], color[2], 0.1);
    for (let i = 0; i < data.length - 1; i++) {
        doc.line(getX(i), getY(data[i]) + 0.5, getX(i + 1), getY(data[i + 1]) + 0.5);
    }

    // Línea principal
    doc.setLineWidth(0.7);
    doc.setDrawColor(color[0], color[1], color[2]);
    for (let i = 0; i < data.length - 1; i++) {
        doc.line(getX(i), getY(data[i]), getX(i + 1), getY(data[i + 1]));
    }

    // Punto final prominente
    const lastX = getX(data.length - 1);
    const lastY = getY(data[data.length - 1]);
    doc.setFillColor(color[0], color[1], color[2]);
    doc.circle(lastX, lastY, 0.8, 'F');
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.3);
    doc.circle(lastX, lastY, 0.4, 'S');

    // Etiquetas de fechas (inicio y fin)
    doc.setFontSize(6);
    doc.setTextColor(100, 116, 139);
    doc.text(labels[0], x, y + height + 5);
    doc.text(labels[labels.length - 1], x + width, y + height + 5, { align: 'right' });

    // Valor actual flotante
    const lastValue = data[data.length - 1];
    const displayValue = lastValue % 1 === 0 ? lastValue.toString() : lastValue.toFixed(1);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(displayValue, x + width, y - 2, { align: 'right' });
    doc.setFont('helvetica', 'normal');
};

export const generatePDFReport = async (data: ReportData) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const primaryColor: [number, number, number] = [37, 99, 235];
    const secondaryColor: [number, number, number] = [71, 85, 105];
    const accentColor: [number, number, number] = [30, 41, 59];

    const logo = await loadImage('/logo_issatec.png');
    if (logo) doc.addImage(logo, 'PNG', pageWidth / 2 - 25, 40, 50, 18);

    doc.setFontSize(26);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text('Informe de Uso del Sistema', pageWidth / 2, 80, { align: 'center' });
    doc.text('por Unidades', pageWidth / 2, 100, { align: 'center' });

    doc.setFontSize(16);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text(data.clientName, pageWidth / 2, 125, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`Periodo comparado: ${data.currentDate} vs ${data.previousDate}`, pageWidth / 2, 140, { align: 'center' });
    doc.text(`Fecha de elaboración: ${new Date().toLocaleDateString()}`, pageWidth / 2, 150, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text('Fuente: Sistema / Dashboard de Gestión', pageWidth / 2, 260, { align: 'center' });

    doc.addPage();
    doc.setFontSize(18);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text('2. Resumen Ejecutivo', 15, 25);
    doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.line(15, 28, 60, 28);

    const legendX = pageWidth - 75;
    const legendY = 22;
    doc.setFontSize(8);
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(legendX, legendY - 2, 3, 3, 'F');
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.text(data.currentDate, legendX + 5, legendY + 1);
    doc.setFillColor(150, 150, 150);
    doc.rect(legendX + 30, legendY - 2, 3, 3, 'F');
    doc.text(data.previousDate, legendX + 35, legendY + 1);

    const totalTurnos = data.units.reduce((acc, u) => acc + u.current.totalTurnos, 0);
    const totalAtendidos = data.units.reduce((acc, u) => acc + u.current.atendidos, 0);
    const totalAbandonos = data.units.reduce((acc, u) => acc + u.current.abandonos, 0);
    const globalAbandono = totalTurnos > 0 ? (totalAbandonos / totalTurnos * 100).toFixed(1) : '0';

    const prevTurnos = data.units.reduce((acc, u) => acc + u.previous.totalTurnos, 0);
    const prevAtendidos = data.units.reduce((acc, u) => acc + u.previous.atendidos, 0);
    const prevAbandonos = data.units.reduce((acc, u) => acc + u.previous.abandonos, 0);
    const prevGlobalAbandono = prevTurnos > 0 ? (prevAbandonos / prevTurnos * 100).toFixed(1) : '0';

    const calcGlobalVar = (curr: number, prev: number) => {
        if (prev === 0) return 0;
        return ((curr - prev) / prev) * 100;
    };

    const varTurnos = calcGlobalVar(totalTurnos, prevTurnos);
    const varAtendidos = calcGlobalVar(totalAtendidos, prevAtendidos);
    const varAbandonos = calcGlobalVar(totalAbandonos, prevAbandonos);

    const fmtGlbPct = (pct: number) => `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;

    const kpiBoxWidth = 35;
    const kpiY = 35;
    const kpis = [
        { label: 'Turnos', curr: formatNumberWithCommas(totalTurnos), prev: formatNumberWithCommas(prevTurnos), var: varTurnos, isBad: false },
        { label: 'Atendidos', curr: formatNumberWithCommas(totalAtendidos), prev: formatNumberWithCommas(prevAtendidos), var: varAtendidos, isBad: false },
        { label: 'Abandono', curr: `${totalAbandonos} (${globalAbandono}%)`, prev: `${prevAbandonos} (${prevGlobalAbandono}%)`, var: varAbandonos, isBad: true },
        { label: 'P. Espera', curr: data.avgWaitTime || '00:00:00', prev: data.prevAvgWaitTime || '00:00:00', var: data.varWaitTime || 0, isBad: true },
        { label: 'P. Servicio', curr: data.avgServTime || '00:00:00', prev: data.prevAvgServTime || '00:00:00', var: data.varServTime || 0, isBad: false }
    ];

    kpis.forEach((kpi, i) => {
        const x = 15 + (i * (kpiBoxWidth + 4));
        doc.setDrawColor(240, 240, 240);
        doc.setFillColor(252, 252, 252);
        doc.rect(x, kpiY, kpiBoxWidth, 32, 'F');
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(kpi.label, x + 3, kpiY + 6);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.text(kpi.curr, x + 3, kpiY + 14);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text(kpi.prev, x + 3, kpiY + 20);
        doc.setFontSize(8);
        const isActuallyBad = kpi.isBad ? kpi.var > 0 : kpi.var < 0;
        doc.setTextColor(isActuallyBad ? 220 : 22, isActuallyBad ? 38 : 163, isActuallyBad ? 38 : 74);
        doc.text(`${fmtGlbPct(kpi.var)}`, x + 3, kpiY + 28);
        doc.setFont('helvetica', 'normal');
    });

    let alertY = 85;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.text('Alertas de Gestión:', 15, alertY);
    doc.setFont('helvetica', 'normal');
    alertY = renderAlertsList(doc, data.units, alertY + 5, '', primaryColor);

    doc.setFontSize(18);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text('3. Tabla Principal de Operación', 15, alertY + 15);

    doc.setFontSize(10);
    doc.setFillColor(37, 99, 235);
    (doc as any).roundedRect(15, alertY + 23, 4, 4, 1, 1, 'F');
    doc.setTextColor(50, 50, 50);
    doc.text(`Hoy: ${data.currentDate}`, 22, alertY + 26.5);

    doc.setFillColor(150, 150, 150);
    (doc as any).roundedRect(pageWidth / 2 + 10, alertY + 23, 4, 4, 1, 1, 'F');
    doc.text(`Ayer: ${data.previousDate}`, pageWidth / 2 + 17, alertY + 26.5);

    const tableBody = data.units.map(u => {
        const fmtPct = (pct: number) => {
            if (isNaN(pct) || !isFinite(pct) || pct === 0) return '0%';
            return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
        };
        const currentAbandono = u.current.totalTurnos > 0 ? (u.current.abandonos / u.current.totalTurnos * 100) : 0;
        const previousAbandono = u.previous.totalTurnos > 0 ? (u.previous.abandonos / u.previous.totalTurnos * 100) : 0;
        const abandonoVar = currentAbandono - previousAbandono;
        return [
            fmtUnitName(u.unidad),
            `${formatNumberWithCommas(u.current.totalTurnos)}\n${formatNumberWithCommas(u.previous.totalTurnos)}\n${fmtPct(u.changes.turnos)}`,
            `${formatNumberWithCommas(u.current.atendidos)}\n${formatNumberWithCommas(u.previous.atendidos)}\n${fmtPct(u.changes.atendidos)}`,
            `${formatNumberWithCommas(u.current.abandonos)}\n${formatNumberWithCommas(u.previous.abandonos)}\n${fmtPct(u.changes.abandonos)}`,
            `${currentAbandono.toFixed(1)}%\n${previousAbandono.toFixed(1)}%\n${fmtPct(abandonoVar)}`,
            `${u.current.tiempoEspera}\n${u.previous.tiempoEspera}\n${fmtPct(u.changes.espera)}`,
            `${u.current.tiempoServicio}\n${u.previous.tiempoServicio}\n${fmtPct(u.changes.servicio)}`
        ];
    });

    (doc as any).autoTable({
        startY: alertY + 40,
        head: [['Unidad', 'Turnos', 'Atend.', 'Aband.', '% Aband.', 'T. Espera', 'T. Serv.']],
        body: tableBody,
        theme: 'striped',
        rowPageBreak: 'avoid',
        headStyles: { fillColor: primaryColor, fontSize: 8, halign: 'center', cellPadding: 2, minCellHeight: 10 },
        styles: { fontSize: 7, cellPadding: 4, lineWidth: 0.1, lineColor: [240, 240, 240], minCellHeight: 20, valign: 'middle' },
        columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 32 },
            1: { halign: 'right', cellWidth: 24 },
            2: { halign: 'right', cellWidth: 24 },
            3: { halign: 'right', cellWidth: 24 },
            4: { halign: 'right', cellWidth: 24 },
            5: { halign: 'right', cellWidth: 26 },
            6: { halign: 'right', cellWidth: 26 }
        },
        didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index > 0) data.cell.text = [];
        },
        didDrawCell: (data: any) => {
            if (data.section === 'body' && data.column.index > 0) {
                const txt = data.cell.raw || '';
                const lines = txt.split('\n');
                if (lines.length === 3) {
                    const x = data.cell.x + data.cell.width - 6;
                    const cellHeight = data.cell.height;
                    const lineHeight = 5;
                    const totalContentHeight = lineHeight * 3;
                    const startY = data.cell.y + (cellHeight / 2) - (totalContentHeight / 2);
                    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
                    doc.setFontSize(8);
                    doc.text(lines[0], x, startY + lineHeight, { align: 'right' });
                    doc.setTextColor(150, 150, 150);
                    doc.setFontSize(7);
                    doc.text(lines[1], x, startY + (lineHeight * 2), { align: 'right' });
                    const variationLine = lines[2];
                    const isIncrease = variationLine.includes('+');
                    const isDecrease = variationLine.includes('-');
                    if (isIncrease || isDecrease) {
                        const badMetrics = [3, 4, 5, 6];
                        const isBadMetric = badMetrics.includes(data.column.index);
                        if (isIncrease) {
                            doc.setTextColor(isBadMetric ? 220 : 22, isBadMetric ? 38 : 163, isBadMetric ? 38 : 74);
                        } else {
                            doc.setTextColor(isBadMetric ? 22 : 220, isBadMetric ? 163 : 38, isBadMetric ? 74 : 38);
                        }
                    } else {
                        doc.setTextColor(100, 100, 100);
                    }
                    doc.setFontSize(7);
                    doc.text(variationLine, x, startY + (lineHeight * 3), { align: 'right' });
                }
            }
        }
    });

    doc.save(`Informe ${data.clientName} ${data.currentDate}.pdf`);
};

export const generateTrend30dReport = async (data: ReportData) => {
    if (!data.units30d || data.units30d.length === 0) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const primaryColor: [number, number, number] = [37, 99, 235];
    const secondaryColor: [number, number, number] = [71, 85, 105];

    const logo = await loadImage('/logo_issatec.png');
    if (logo) doc.addImage(logo, 'PNG', pageWidth / 2 - 25, 40, 50, 18);

    doc.setFontSize(26);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text('Informe de Tendencias', pageWidth / 2, 80, { align: 'center' });
    doc.text('Últimos 30 Días', pageWidth / 2, 100, { align: 'center' });

    doc.setFontSize(16);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text(data.clientName, pageWidth / 2, 125, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`Comparativo: Hoy (${data.currentDate}) vs Promedio 30 Días`, pageWidth / 2, 140, { align: 'center' });
    doc.text(`Fecha de elaboración: ${new Date().toLocaleDateString()}`, pageWidth / 2, 150, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text('Fuente: Sistema / Dashboard de Gestión', pageWidth / 2, 260, { align: 'center' });

    // --- 2. ALERTAS Y ANÁLISIS VISUAL ---
    doc.addPage();
    let currentY = 20;

    // Renderizar Gráficas si hay historial
    if (data.trendHistory && data.trendHistory.length > 0) {
        const history = [...data.trendHistory].sort((a, b) => a.fecha.localeCompare(b.fecha));
        const labels = history.map(d => d.fecha.split('-').reverse().join('/')); // DD/MM/YYYY

        const chartWidth = pageWidth - 30; // Ancho completo manteniendo márgenes
        const chartHeight = 40;
        const spacing = 18;

        const convertToMinutes = (timeStr: string) => {
            if (!timeStr) return 0;
            const p = timeStr.split(':').map(Number);
            return p[0] * 60 + p[1] + p[2] / 60;
        };

        const metrics = [
            { title: 'Uso de Unidades', data: history.map(d => d.unidades), color: [37, 99, 235] },
            { title: 'Total Turnos', data: history.map(d => d.totalTurnos), color: [79, 70, 229] },
            { title: 'Atendidos', data: history.map(d => d.atendidos), color: [16, 185, 129] },
            { title: 'Abandonos', data: history.map(d => d.abandonos), color: [239, 68, 68] },
            { title: 'Prom. Espera (Min)', data: history.map(d => convertToMinutes(d.avgWaitTime)), color: [245, 158, 11] },
            { title: 'Prom. Servicio (Min)', data: history.map(d => convertToMinutes(d.avgServTime)), color: [139, 92, 246] }
        ];

        let chartY = currentY + 10;
        metrics.forEach((m) => {
            const chartX = 15;

            // Si la gráfica sobrepasa el límite de la página, añadir nueva página
            if (chartY + chartHeight + spacing > 280) {
                doc.addPage();
                chartY = 20;
            }

            drawLineChart(doc, m.data, labels, m.title, chartX, chartY, chartWidth, chartHeight, m.color);
            chartY += chartHeight + spacing;
        });

        currentY = chartY + 5;
    }

    // Alertas debajo de las gráficas o en nueva página si no caben
    if (currentY > 180) {
        doc.addPage();
        currentY = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text('Análisis Detallado de Eventos (Últimos 30 Días):', 15, currentY);
    currentY = analyzeAndRenderHistoryAlerts(doc, data.fullUnitHistory || [], currentY + 7);

    doc.save(`Tendencia 30d ${data.clientName} ${data.currentDate}.pdf`);
};
