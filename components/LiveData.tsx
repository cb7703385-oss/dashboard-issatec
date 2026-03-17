import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    Line, ComposedChart, ReferenceLine, PieChart, Pie, Cell
} from 'recharts';
import { LiveDataItem } from '../types';

type ZoomLevel = 'hour' | '30min' | 'minute';

interface AuthUser {
    userId: string;
    username: string;
    rol: string;
    nombre: string;
}

interface LiveDataProps {
    user?: AuthUser;
    onLogout?: () => void;
    onOpenAdmin?: () => void;
}
const getToken = () => localStorage.getItem('auth_token') || '';

const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`,
});

export const LiveData: React.FC<LiveDataProps> = ({ user, onLogout, onOpenAdmin }) => {
    const [hourData, setHourData] = useState<LiveDataItem[]>([]);
    const [minuteData, setMinuteData] = useState<LiveDataItem[]>([]);
    const [globals, setGlobals] = useState<any>(null);
    const [sedes, setSedes] = useState<string[]>([]);
    const [servicios, setServicios] = useState<string[]>([]);
    const [sedeSearch, setSedeSearch] = useState<string>('');
    const [serviceSearch, setServiceSearch] = useState<string>('');
    const [showSedeDropdown, setShowSedeDropdown] = useState<boolean>(false);
    const [showServiceDropdown, setShowServiceDropdown] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedSede, setSelectedSede] = useState<string>('');
    const [selectedService, setSelectedService] = useState<string>('');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
    const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('minute');
    const [focusedHour, setFocusedHour] = useState<string | null>(null);
    const [visibleLines, setVisibleLines] = useState({
        volumen: true,
        abandonos: true,
        espera: true,
        servicio: true
    });
    const [activePoint, setActivePoint] = useState<any>(null);
    const [showWaitingModal, setShowWaitingModal] = useState(false);
    const [showMaxWaitModal, setShowMaxWaitModal] = useState(false);
    const [showMaxServiceModal, setShowMaxServiceModal] = useState(false);
    const [showObjetivoModal, setShowObjetivoModal] = useState(false);
    const [agentModalType, setAgentModalType] = useState<'AgentsSignedIn' | 'AgentsInService' | 'AgentsIdle' | 'AgentsInBackOffice' | 'AgentsInReception' | null>(null);
    const [agentDrillUnit, setAgentDrillUnit] = useState<string | null>(null);
    const [agentDrillData, setAgentDrillData] = useState<any[]>([]);
    const [agentDrillLoading, setAgentDrillLoading] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);

    // Waiting tickets drill-down state
    const [waitingDrillUnit, setWaitingDrillUnit] = useState<string | null>(null);
    const [waitingDrillData, setWaitingDrillData] = useState<any[]>([]);
    const [waitingDrillLoading, setWaitingDrillLoading] = useState(false);
    const [waitingDrillView, setWaitingDrillView] = useState<'detail' | 'summary'>('detail');

    const openWaitingDrill = async (unitName: string) => {
        setWaitingDrillUnit(unitName);
        setWaitingDrillData([]);
        setWaitingDrillLoading(true);
        setWaitingDrillView('detail');
        try {
            const dateParam = window.location.search.includes('date=')
                ? new URLSearchParams(window.location.search).get('date')
                : new Date().toISOString().split('T')[0];
            const resp = await fetch(`/api/waiting-tickets?unitName=${encodeURIComponent(unitName)}&date=${dateParam}`, { headers: authHeaders() });
            const data = await resp.json();
            if (resp.status === 401 && data.error === 'SESSION_INVALIDATED') {
                onLogout?.();
                return;
            }
            setWaitingDrillData(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching waiting tickets:', err);
            setWaitingDrillData([]);
        } finally {
            setWaitingDrillLoading(false);
        }
    };

    // Service tickets drill-down state
    const [serviceDrillUnit, setServiceDrillUnit] = useState<string | null>(null);
    const [serviceDrillData, setServiceDrillData] = useState<any[]>([]);
    const [serviceDrillLoading, setServiceDrillLoading] = useState(false);
    const [serviceDrillView, setServiceDrillView] = useState<'detail' | 'summary'>('detail');

    // Similar helper method for openServiceDrill (if not defined directly in JSX)
    const openServiceDrill = async (unitName: string) => {
        setServiceDrillUnit(unitName);
        setServiceDrillData([]);
        setServiceDrillLoading(true);
        setServiceDrillView('detail');
        try {
            const dateParam = window.location.search.includes('date=')
                ? new URLSearchParams(window.location.search).get('date')
                : new Date().toISOString().split('T')[0];
            const resp = await fetch(`/api/service-tickets?unitName=${encodeURIComponent(unitName)}&date=${dateParam}`, { headers: authHeaders() });
            const data = await resp.json();
            if (resp.status === 401 && data.error === 'SESSION_INVALIDATED') {
                onLogout?.();
                return;
            }
            setServiceDrillData(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching service tickets:', err);
            setServiceDrillData([]);
        } finally {
            setServiceDrillLoading(false);
        }
    };

    // Component constraint isolated live timer to prevent entire app from re-rendering every second
    const LiveTimerBadge = ({ fetchedSecs, warningSecs, criticalSecs }: { fetchedSecs: number, warningSecs: number, criticalSecs: number }) => {
        const [tick, setTick] = useState(0);
        useEffect(() => {
            const interval = setInterval(() => setTick(t => t + 1), 1000);
            return () => clearInterval(interval);
        }, []);

        const liveSecs = fetchedSecs + tick;
        const h = String(Math.floor(liveSecs / 3600)).padStart(2, '0');
        const m = String(Math.floor((liveSecs % 3600) / 60)).padStart(2, '0');
        const s = String(liveSecs % 60).padStart(2, '0');

        let badgeClass = 'text-green-700 font-bold';
        if (liveSecs >= criticalSecs) {
            badgeClass = 'bg-[#F15B4E] text-white px-1.5 py-0.5 rounded font-bold shadow-sm';
        } else if (liveSecs >= warningSecs) {
            badgeClass = 'bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold shadow-sm';
        }

        return <span className={`${badgeClass} inline-block text-center w-[75px]`}>{h}:{m}:{s}</span>;
    };



    const [agentDrillSort, setAgentDrillSort] = useState<'FullName' | 'FunctionName' | 'AgentState'>('FullName');
    const [agentDrillDir, setAgentDrillDir] = useState<'asc' | 'desc'>('asc');

    const handleDrillSort = (col: 'FullName' | 'FunctionName' | 'AgentState') => {
        if (agentDrillSort === col) {
            setAgentDrillDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setAgentDrillSort(col);
            setAgentDrillDir('asc');
        }
    };

    const openAgentDrill = async (unitName: string, agentType: string) => {
        setAgentDrillUnit(unitName);
        setAgentDrillData([]);
        setAgentDrillLoading(true);
        try {
            const resp = await fetch(`/api/agents-by-unit?unitName=${encodeURIComponent(unitName)}&agentType=${encodeURIComponent(agentType)}`, { headers: authHeaders() });
            const data = await resp.json();
            if (resp.status === 401 && data.error === 'SESSION_INVALIDATED') {
                onLogout?.();
                return;
            }
            setAgentDrillData(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching agent drill data:', err);
            setAgentDrillData([]);
        } finally {
            setAgentDrillLoading(false);
        }
    };

    // AI Chat State
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', content: string }[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [allAgentsData, setAllAgentsData] = useState<any[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const chartRef = useRef<HTMLDivElement>(null);

    // Load all agents when chat is opened (lazy, only once)
    useEffect(() => {
        if (isChatOpen && allAgentsData.length === 0) {
            fetch('/api/all-agents', { headers: authHeaders() })
                .then(r => {
                    if (r.status === 401) {
                        onLogout?.();
                        throw new Error('SESSION_INVALIDATED');
                    }
                    return r.json();
                })
                .then(data => setAllAgentsData(Array.isArray(data) ? data : []))
                .catch(() => { });
        }
    }, [isChatOpen]);

    // Scroll chat to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, isChatOpen]);

    const handleSendChatMessage = async (presetMessage?: string) => {
        const messageToSend = presetMessage || chatInput;
        if (!messageToSend.trim() || isChatLoading) return;

        // Add user message to UI
        const currentMessages = [...chatMessages];
        const newMessages = [...currentMessages, { role: 'user' as const, content: messageToSend }];
        setChatMessages(newMessages);
        setChatInput('');
        setIsChatLoading(true);

        try {
            // Build Context Payload
            const agentsByUnit = (globals?.WaitingByUnit as any[] || []).map((u: any) => ({
                Unidad: u.UnitName,
                Logueados: u.AgentsSignedIn || 0,
                EnAtencion: u.AgentsInService || 0,
                Inactivos: u.AgentsIdle || 0,
                Backoffice: u.AgentsInBackOffice || 0,
                Recepcion: u.AgentsInReception || 0,
            }));

            const context = {
                globals,
                WaitingByUnit: globals?.WaitingByUnit,
                dailyStats,
                AGENTES_POR_UNIDAD: agentsByUnit,
                TODOS_LOS_AGENTES_ACTIVOS: allAgentsData.map((a: any) => ({
                    Nombre: a.FullName,
                    Estado: a.AgentState,
                    Funcion: a.FunctionName,
                    Sede: a.UnitName
                })),
                ...(agentDrillUnit && agentDrillData.length > 0 ? {
                    AGENTES_DETALLE_UNIDAD: {
                        Unidad: agentDrillUnit,
                        Total: agentDrillData.length,
                        Agentes: agentDrillData.map((a: any) => ({
                            Nombre: a.FullName,
                            Funcion: a.FunctionName,
                            Estado: a.AgentState,
                        }))
                    }
                } : {})
            };

            const response = await fetch('/api/ai-chat', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    message: messageToSend,
                    history: currentMessages,
                    context
                })
            });

            if (response.status === 401) {
                onLogout?.();
                return;
            }

            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();

            setChatMessages([...newMessages, { role: 'model' as const, content: data.reply }]);
        } catch (error) {
            console.error('Error with AI Chat:', error);
            setChatMessages([...newMessages, { role: 'model' as const, content: 'Lo siento, hubo un problema al conectar con el servidor. Intenta nuevamente.' }]);
        } finally {
            setIsChatLoading(false);
        }
    };

    // Manual wheel event listener to allow preventDefault (non-passive)
    useEffect(() => {
        const chartElement = chartRef.current;
        if (!chartElement) return;

        const onWheel = (e: WheelEvent) => {
            if (chartElement.contains(e.target as Node)) {
                e.preventDefault();
                const delta = e.deltaY;
                const zoomStep = 6; // percent per scroll tick

                setZoomRange(prev => {
                    const windowSize = prev.end - prev.start;

                    // Where is the mouse along the visible window? (0=left, 1=right)
                    const chartWidth = mousePosRef.current.chartWidth || chartElement.offsetWidth;
                    const cursorFrac = chartWidth > 0
                        ? Math.max(0, Math.min(1, mousePosRef.current.x / chartWidth))
                        : 0.5;

                    // Cursor's absolute position in the full dataset (0..100)
                    const cursorAbs = prev.start + cursorFrac * windowSize;

                    if (delta < 0) { // Zoom In — shrink window toward cursor
                        const shrink = zoomStep;
                        let newStart = prev.start + shrink * cursorFrac;
                        let newEnd = prev.end - shrink * (1 - cursorFrac);
                        // Clamp: min window = 5%
                        if (newEnd - newStart < 5) {
                            newStart = cursorAbs - 2.5;
                            newEnd = cursorAbs + 2.5;
                        }
                        newStart = Math.max(0, newStart);
                        newEnd = Math.min(100, newEnd);
                        return { start: newStart, end: newEnd };
                    } else { // Zoom Out — expand window from cursor
                        const expand = zoomStep;
                        let newStart = Math.max(0, prev.start - expand * cursorFrac);
                        let newEnd = Math.min(100, prev.end + expand * (1 - cursorFrac));
                        return { start: newStart, end: newEnd };
                    }
                });
            }
        };

        chartElement.addEventListener('wheel', onWheel, { passive: false });
        return () => chartElement.removeEventListener('wheel', onWheel);
    }, []);

    // --- Interactive Zoom & Crosshair States ---
    const [zoomRange, setZoomRange] = useState({ start: 0, end: 100 });
    // SVG overlay crosshair - tracks raw pixel coordinates
    const [mousePos, setMousePos] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
    const mousePosRef = useRef({ x: 0, chartWidth: 0 }); // stable ref for use inside wheel handler
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState(0);

    const fetchLiveData = async (granularity: ZoomLevel) => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams({
                granularity,
                date: selectedDate
            });
            if (selectedSede) params.append('unit', selectedSede);
            if (selectedService) params.append('service', selectedService);

            const response = await fetch(`/api/live-data?${params.toString()}`, { headers: authHeaders() });
            const json = await response.json();

            if (!response.ok) {
                if (json.error === 'SESSION_INVALIDATED' || response.status === 401) {
                    onLogout?.();
                    return;
                }
                console.error('API Error:', json);
                throw new Error(json.error || 'Error al cargar datos en vivo');
            }


            // Handle new response structure with data and globals
            const detailData = json.data || json; // Fallback to old structure if needed
            const globalsData = json.globals || null;

            if (granularity === 'hour') {
                setHourData(detailData);
            } else {
                setMinuteData(detailData);
            }

            // Update globals if present (real-time supervisor data)
            if (globalsData) {
                setGlobals(globalsData);
            }

            setLastUpdate(new Date());
            setError(null);
        } catch (err) {
            console.error('Fetch error:', err);
            setError(err instanceof Error ? err.message : 'Error desconocido');
        } finally {
            setIsLoading(false);
        }
    };

    // Fetch filter options on mount and when date changes
    useEffect(() => {
        const fetchOptions = async () => {
            try {
                const response = await fetch(`/api/live-data/options?date=${selectedDate}`, { headers: authHeaders() });
                const data = await response.json();
                if (response.status === 401 && data.error === 'SESSION_INVALIDATED') {
                    onLogout?.();
                    return;
                }
                setSedes(data.units || []);
                setServicios(data.services || []);
            } catch (err) {
                console.error('Error fetching filter options:', err);
            }
        };
        fetchOptions();
    }, [selectedDate]);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.relative')) {
                setShowSedeDropdown(false);
                setShowServiceDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Load both hour and minute data on mount and filter changes
    useEffect(() => {
        fetchLiveData('hour');
        fetchLiveData('minute');
        const interval = setInterval(() => {
            fetchLiveData('hour');
            fetchLiveData('minute');
        }, 90000); // Refresh every 90 seconds
        return () => clearInterval(interval);
    }, [selectedSede, selectedService, selectedDate]);

    // Custom tooltip that updates focused hour on hover
    const CustomTooltip = ({ active, payload }: any) => {
        // Update focused hour when tooltip is active in hour view
        if (active && payload && payload[0] && zoomLevel === 'hour') {
            const hoveredTime = payload[0].payload.Hora_Minuto;
            if (hoveredTime) {
                const hour = hoveredTime.substring(0, 2);
                // Use setTimeout to avoid state updates during render
                setTimeout(() => {
                    if (hour !== focusedHour) {
                        console.log('✅ Hovering over hour:', hour);
                        setFocusedHour(hour);
                    }
                }, 0);
            }
        }

        if (!active || !payload || !payload.length) return null;

        const formatSeconds = (seconds: number) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        };

        return (
            <div style={{
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                boxShadow: '0 8px 20px -4px rgb(0 0 0 / 0.12)',
                backgroundColor: 'rgba(255, 255, 255, 0.45)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                padding: '12px'
            }}>
                <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                    {payload[0].payload.Hora_Minuto}
                </p>
                {payload.map((entry: any, index: number) => {
                    const isVolume = entry.dataKey === 'DisplayVolumen';
                    const isAbandons = entry.dataKey === 'DisplayAbandonos';
                    const value = entry.value;
                    const cumulative = isVolume ? entry.payload.CumulativeVolumen : isAbandons ? entry.payload.CumulativeAbandonos : null;

                    return (
                        <p key={index} style={{
                            color: entry.color,
                            fontWeight: 'bold',
                            fontSize: '12px',
                            margin: '4px 0'
                        }}>
                            {entry.name}: {
                                entry.name.includes('Tiempo') || entry.name.includes('espera') || entry.name.includes('atención') || entry.name.includes('servicio')
                                    ? formatSeconds(value)
                                    : value
                            }
                            {cumulative !== null && (
                                <span style={{ fontSize: '12px', fontWeight: 'bold', marginLeft: '6px' }}>
                                    (Total: {Number(cumulative).toLocaleString('es-CO')})
                                </span>
                            )}
                        </p>
                    );
                })}
            </div>
        );
    };


    const formatSeconds = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const dailyStats = useMemo(() => {
        // Use globals from backend if available, otherwise calculate from minuteData
        if (globals) {
            const volumenTotal = selectedService
                ? (globals.TotalTurnosPorServicio || 0)
                : selectedSede
                    ? (globals.GlobalOficina_TotalTurnos || 0)
                    : (globals.Global_TotalTurnos || 0);

            const abandonosTotal = selectedService
                ? (globals.AbandonadosPorServicio || 0)
                : selectedSede
                    ? (globals.GlobalOficina_Abandonados || 0)
                    : (globals.Global_Abandonados || 0);

            const esperaProm = selectedService
                ? (globals.AvgEsperaSeg_Servicio || 0)
                : selectedSede
                    ? (globals.GlobalOficina_AvgEsperaSeg || 0)
                    : (globals.Global_AvgEsperaSeg || 0);

            const servicioProm = selectedService
                ? (globals.AvgAtencionSeg_Servicio || 0)
                : selectedSede
                    ? (globals.GlobalOficina_AvgAtencionSeg || 0)
                    : (globals.Global_AvgAtencionSeg || 0);

            return {
                volumenTotal,
                abandonosTotal,
                esperaProm,
                servicioProm
            };
        }

        // Fallback: calculate from minuteData if globals not available
        const stats = {
            volumenTotal: 0,
            abandonosTotal: 0,
            esperaProm: 0,
            servicioProm: 0
        };

        if (minuteData && (minuteData as any[]).length > 0) {
            let waitSum = 0;
            let waitCount = 0;
            let serviceSum = 0;
            let serviceCount = 0;

            (minuteData as any[]).forEach(d => {
                // Sum Atendidos and Abandonos separately
                const atendidos = Number(d.Atendidos) || 0;
                const abandonos = Number(d.Abandonos) || 0;

                stats.volumenTotal += (atendidos + abandonos);
                stats.abandonosTotal += abandonos;

                // Only include non-null/non-zero values in average calculations
                if (d.Segundos_Espera !== null && d.Segundos_Espera !== undefined && !isNaN(d.Segundos_Espera)) {
                    waitSum += Number(d.Segundos_Espera);
                    waitCount++;
                }

                if (d.Segundos_Servicio !== null && d.Segundos_Servicio !== undefined && !isNaN(d.Segundos_Servicio)) {
                    serviceSum += Number(d.Segundos_Servicio);
                    serviceCount++;
                }
            });

            if (waitCount > 0) {
                stats.esperaProm = waitSum / waitCount;
            }

            if (serviceCount > 0) {
                stats.servicioProm = serviceSum / serviceCount;
            }
        }

        return stats;
    }, [globals, minuteData, selectedSede, selectedService]);

    const visibleData = useMemo(() => {
        // ── Determine last DB update time FIRST so the chart ends there ──────────
        const sourceData = minuteData && (minuteData as any[]).length > 0 ? minuteData as any[] :
            hourData && (hourData as any[]).length > 0 ? hourData as any[] : [];

        let effectiveNow = new Date();
        let effectiveNowStr = `${effectiveNow.getHours().toString().padStart(2, '0')}:${effectiveNow.getMinutes().toString().padStart(2, '0')}`;

        if (sourceData.length > 0) {
            const maxTimeStr = sourceData.reduce((max: string, curr: any) =>
                curr.Hora_Minuto > max ? curr.Hora_Minuto : max, '00:00');
            if (maxTimeStr > '00:00') {
                effectiveNowStr = maxTimeStr;
                const [eh, em] = maxTimeStr.split(':').map(Number);
                effectiveNow = new Date();
                effectiveNow.setHours(eh, em, 0, 0);
            }
        }

        // Chart stops at last DB time + 1 hour of empty padding on the right
        const endHour = Math.min(23, effectiveNow.getHours() + 1);
        const endMinute = effectiveNow.getMinutes();

        let fullDayData: any[] = [];

        if (zoomLevel === 'hour') {
            const dataMap = new Map((hourData as any[]).map(d => [d.Hora_Minuto, d]));
            for (let h = 0; h <= 23; h++) {
                const hourStr = `${h.toString().padStart(2, '0')}:00`;
                const existing = dataMap.get(hourStr);
                if (existing) {
                    fullDayData.push({ ...existing, waitSec: existing.Segundos_Espera, serviceSec: existing.Segundos_Servicio });
                } else if (h < endHour) {
                    // empty slot before the last DB hour
                    fullDayData.push({ Hora_Minuto: hourStr });
                }
            }
        } else if (zoomLevel === '30min') {
            const buckets: { [key: string]: any } = {};
            (minuteData as any[]).forEach(d => {
                const [h, m] = d.Hora_Minuto.split(':').map(Number);
                const bucketMin = m < 30 ? '00' : '30';
                const bucketKey = `${h.toString().padStart(2, '0')}:${bucketMin}`;
                if (!buckets[bucketKey]) {
                    buckets[bucketKey] = { ...d, Hora_Minuto: bucketKey, Atendidos: 0, Abandonos: 0, Total_Turnos: 0, waitSecSum: 0, serviceSecSum: 0, count: 0 };
                }
                buckets[bucketKey].Atendidos += d.Atendidos || 0;
                buckets[bucketKey].Abandonos += d.Abandonos || 0;
                buckets[bucketKey].Total_Turnos += d.Total_Turnos || 0;
                buckets[bucketKey].waitSecSum += d.Segundos_Espera || 0;
                buckets[bucketKey].serviceSecSum += d.Segundos_Servicio || 0;
                buckets[bucketKey].count += 1;
            });
            const processedBuckets = Object.values(buckets).map((b: any) => ({
                ...b, waitSec: b.waitSecSum / (b.count || 1), serviceSec: b.serviceSecSum / (b.count || 1)
            }));
            const bucketMap = new Map(processedBuckets.map(b => [b.Hora_Minuto, b]));
            for (let h = 0; h <= 23; h++) {
                for (let m of ['00', '30']) {
                    const key = `${h.toString().padStart(2, '0')}:${m}`;
                    const slotMin = Number(m);
                    const isPastSlot = h < endHour || (h === endHour && slotMin <= endMinute);
                    const existing = bucketMap.get(key);
                    if (existing) {
                        fullDayData.push(existing);
                    } else if (isPastSlot) {
                        fullDayData.push({ Hora_Minuto: key });
                    }
                }
            }
        } else {
            const dataMap = new Map((minuteData as any[]).map(d => [d.Hora_Minuto, d]));
            for (let h = 0; h <= 23; h++) {
                const hourStr = h.toString().padStart(2, '0');
                for (let m = 0; m < 60; m++) {
                    const minStr = m.toString().padStart(2, '0');
                    const key = `${hourStr}:${minStr}`;
                    const existing = dataMap.get(key);
                    const isPastSlot = h < endHour || (h === endHour && m <= endMinute);

                    if (existing) {
                        fullDayData.push({ ...existing, waitSec: existing.Segundos_Espera, serviceSec: existing.Segundos_Servicio });
                    } else if (isPastSlot) {
                        fullDayData.push({ Hora_Minuto: key });
                    }
                }
            }
        }

        // Sort by time to ensure correct line drawing
        fullDayData.sort((a, b) => {
            return a.Hora_Minuto.localeCompare(b.Hora_Minuto);
        });

        // CONVERT TO CUMULATIVE & RUNNING AVERAGE (To match KPIs and stay "up")
        let accumVolumen = 0;
        let accumAbandonos = 0;
        // Weighted sums: accumulate (avg_seconds * count) so final = sum / total_count
        let accumWaitWeightedSum = 0;
        let accumWaitWeightTotal = 0;
        let accumServiceWeightedSum = 0;
        let accumServiceWeightTotal = 0;

        // Forward-fill accumulators: last known non-zero values per metric
        let lastVolumen = 0;
        let lastAbandonos = 0;
        let lastEspera: number | undefined = undefined;
        let lastServicio: number | undefined = undefined;

        const result = fullDayData.map(d => {
            const hasData = d.Total_Turnos !== undefined || d.Atendidos !== undefined || (d.waitSec !== undefined && d.waitSec !== null);

            if (hasData) {
                accumVolumen += (Number(d.Total_Turnos) || 0);
                accumAbandonos += (Number(d.Abandonos) || 0);

                // Weighted by correct turn counts per metric:
                // Espera uses TurnosConEspera (EntityStatus=3 count) — same population as BigQuery's AVG
                // Falls back to Atendidos if TurnosConEspera not yet available (old cached query)
                // Servicio uses Atendidos (EntityStatus=6 count)
                const atendidosMinuto = Number(d.Atendidos) || 0;
                const turnosConEspera = Number(d.TurnosConEspera) || atendidosMinuto;

                if (d.waitSec !== undefined && d.waitSec !== null && d.waitSec > 0 && turnosConEspera > 0) {
                    accumWaitWeightedSum += d.waitSec * turnosConEspera;
                    accumWaitWeightTotal += turnosConEspera;
                }
                if (d.serviceSec !== undefined && d.serviceSec !== null && d.serviceSec > 0 && atendidosMinuto > 0) {
                    accumServiceWeightedSum += d.serviceSec * atendidosMinuto;
                    accumServiceWeightTotal += atendidosMinuto;
                }

                // Update forward-fill trackers with real values
                lastVolumen = Number(d.Total_Turnos) || 0;
                lastAbandonos = Number(d.Abandonos) || 0;
                if (d.waitSec != null && d.waitSec > 0) lastEspera = d.waitSec;
                if (d.serviceSec != null && d.serviceSec > 0) lastServicio = d.serviceSec;
            }

            // Determine if this slot is within the real DB data range (not the empty padding zone)
            const [h, m] = d.Hora_Minuto.split(':').map(Number);
            const slotTime = new Date();
            slotTime.setHours(h, m !== undefined ? m : 0, 0, 0);

            // Forward-fill only up to the last DB update — slots in the +1h padding stay empty
            const isActuallyPast = slotTime <= effectiveNow;

            return {
                ...d,
                // DisplayVolumen/Abandonos show the interval "spikes"
                // For past slots without data (gap between last update and now), forward-fill last known value
                DisplayVolumen: hasData ? (Number(d.Total_Turnos) || 0) : isActuallyPast ? lastVolumen : undefined,
                DisplayAbandonos: hasData ? (Number(d.Abandonos) || 0) : isActuallyPast ? lastAbandonos : undefined,
                // Cumulative variants for tooltips
                CumulativeVolumen: accumVolumen,
                CumulativeAbandonos: accumAbandonos,
                // Weighted running average matches BigQuery's turn-weighted Global_AvgEsperaSeg / Global_AvgAtencionSeg
                RunningEspera: isActuallyPast && accumWaitWeightTotal > 0 ? accumWaitWeightedSum / accumWaitWeightTotal : undefined,
                RunningServicio: isActuallyPast && accumServiceWeightTotal > 0 ? accumServiceWeightedSum / accumServiceWeightTotal : undefined,
                // Keep raw per-minute values for tooltip reference
                DisplayEspera: hasData ? (d.waitSec || 0) : isActuallyPast ? lastEspera : undefined,
                DisplayServicio: hasData ? (d.serviceSec || 0) : isActuallyPast ? lastServicio : undefined,
            };
        });

        // REMOVED: SNAP DATA TO KPI TOTALS
        // We no longer snap to daily totals to keep interval-based Y-axis scaling correct.

        // SLICE LEADING EMPTY DATA
        let activityFound = false;
        const filtered = result.filter((d: any) => {
            if (activityFound) return true;
            const hour = parseInt(d.Hora_Minuto.split(':')[0]);
            const activityVal = (Number(d.DisplayVolumen) || 0);
            if (activityVal > 0) {
                // Start exactly where activity begins (e.g. 06:00)
                if (hour < 6 && activityVal <= 2) return false;
                activityFound = true;
                return true;
            }
            return false;
        });

        return filtered.length > 0 ? filtered : result.slice(Math.max(0, endHour - 2));
    }, [hourData, minuteData, zoomLevel, focusedHour, dailyStats]);

    // Data actually displayed based on Zoom Range
    const displayData = useMemo(() => {
        const len = visibleData.length;
        if (len === 0) return [];
        const startIdx = Math.floor((zoomRange.start / 100) * (len - 1));
        const endIdx = Math.ceil((zoomRange.end / 100) * (len - 1));
        return visibleData.slice(startIdx, endIdx + 1);
    }, [visibleData, zoomRange]);

    const xTicks = useMemo(() => {
        const data = displayData;
        const totalPoints = data.length;

        // Dynamic tick density based on number of visible data points
        // Each data point = 1 minute, so totalPoints ≈ visible minutes
        let filterFreq: number;
        if (totalPoints <= 60) filterFreq = 1;        // every minute
        else if (totalPoints <= 150) filterFreq = 5;  // every 5 min
        else if (totalPoints <= 300) filterFreq = 15; // every 15 min
        else filterFreq = 30;                          // every 30 min

        return data
            .filter((d: any) => {
                const [h, m] = d.Hora_Minuto.split(':').map(Number);
                return m % filterFreq === 0;
            })
            .map((d: any) => d.Hora_Minuto);
    }, [displayData]);


    // Recharts onMouseMove — only used for panning
    const handleChartMouseMove = (state: any) => {
        if (!isPanning || !state?.chartX) return;
        const deltaX = (state.chartX - panStart) / 5;
        setZoomRange(prev => {
            let newStart = prev.start - (deltaX / visibleData.length) * 100;
            let newEnd = prev.end - (deltaX / visibleData.length) * 100;
            if (newStart < 0) { newEnd -= newStart; newStart = 0; }
            if (newEnd > 100) { newStart -= (newEnd - 100); newEnd = 100; }
            return { start: newStart, end: newEnd };
        });
        setPanStart(state.chartX);
    };

    const handleDoubleClick = () => {
        setZoomRange({ start: 0, end: 100 });
    };

    const formatDuration = (totalSeconds: number) => {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = Math.round(totalSeconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };



    const lastPoints = useMemo(() => {
        const rev = [...visibleData].reverse();
        // Each metric independently finds its last real DB value (from raw source fields, not forward-fills)
        const lv = rev.find(d => d.Total_Turnos !== undefined && Number(d.Total_Turnos) > 0);
        const la = rev.find(d => d.Abandonos !== undefined && Number(d.Abandonos) > 0);
        const le = rev.find(d => d.RunningEspera !== undefined && d.RunningEspera > 0);
        const ls = rev.find(d => d.RunningServicio !== undefined && d.RunningServicio > 0);
        return {
            volumen: lv ? Number(lv.Total_Turnos) : null,
            abandonos: la ? Number(la.Abandonos) : null,
            espera: le ? le.RunningEspera : null,
            servicio: ls ? ls.RunningServicio : null,
        };
    }, [visibleData]);

    // Helper function to get card color based on wait time thresholds
    const getWaitTimeCardColor = () => {
        if (!globals) return 'from-[#F1DB51] to-[#e6cf3c]'; // Default yellow

        const waitTime = dailyStats.esperaProm;
        let warning, critical;

        if (selectedService) {
            // Servicio: usar umbrales específicos del servicio
            warning = globals.WaitingTimeWarning;
            critical = globals.WaitingTimeCritical;
        } else if (selectedSede) {
            // Unidad: usar promedio de umbrales de servicios de la unidad
            warning = globals.Oficina_AvgWaitingTimeWarning;
            critical = globals.Oficina_AvgWaitingTimeCritical;
        } else {
            // Global: usar promedio de todos los umbrales
            warning = globals.Global_AvgWaitingTimeWarning;
            critical = globals.Global_AvgWaitingTimeCritical;
        }

        if (critical && waitTime >= critical) {
            return 'from-[#F15B4E] to-[#cc4b3f]'; // Red for critical
        } else if (warning && waitTime >= warning) {
            return 'from-[#F1DB51] to-[#e6cf3c]'; // Yellow for warning
        }
        return 'from-[#A3CF62] to-[#93ba58]'; // Green for normal
    };

    const getServiceTimeCardColor = () => {
        if (!globals) return 'from-blue-500 to-blue-600'; // Default blue

        const serviceTime = dailyStats.servicioProm;
        let warning, critical;

        if (selectedService) {
            // Servicio: usar umbrales específicos del servicio
            warning = globals.ServiceTimeWarning;
            critical = globals.ServiceTimeCritical;
        } else if (selectedSede) {
            // Unidad: usar promedio de umbrales de servicios de la unidad
            warning = globals.Oficina_AvgServiceTimeWarning;
            critical = globals.Oficina_AvgServiceTimeCritical;
        } else {
            // Global: usar promedio de todos los umbrales
            warning = globals.Global_AvgServiceTimeWarning;
            critical = globals.Global_AvgServiceTimeCritical;
        }

        if (critical && serviceTime >= critical) {
            return 'from-[#F15B4E] to-[#cc4b3f]'; // Red for critical
        } else if (warning && serviceTime >= warning) {
            return 'from-[#F1DB51] to-[#e6cf3c]'; // Yellow for warning
        }
        return 'from-[#A3CF62] to-[#93ba58]'; // Green for normal
    };

    // Function to render warning/critical counters
    const renderStatusCounters = (type: 'wait' | 'service') => {
        if (!globals) return null;

        let critical = 0, warning = 0, total = 0;

        if (type === 'wait') {
            // Context-aware: use services when a unit is selected, offices for global view
            // (mirrors what the Rankings table shows in each context)
            const rows: any[] = selectedSede
                ? (globals.Top_Servicios_Espera || [])
                : (globals.Top_Unidades_Espera || []);

            if (rows.length > 0) {
                critical = rows.filter((r: any) => {
                    const val = Number(r.AvgEspera || 0);
                    const crit = Number(r.WaitingTimeCritical || 0);
                    return crit > 0 && val >= crit;
                }).length;
                warning = rows.filter((r: any) => {
                    const val = Number(r.AvgEspera || 0);
                    const warn = Number(r.WaitingTimeWarning || 0);
                    const crit = Number(r.WaitingTimeCritical || 0);
                    return warn > 0 && val >= warn && (crit === 0 || val < crit);
                }).length;
                total = rows.length;
            } else {
                // Fallback to backend aggregated
                if (selectedService) {
                    critical = globals.OficinasByService_Espera_Critical || 0;
                    warning = globals.OficinasByService_Espera_Warning || 0;
                    total = globals.OficinasByService_Total || 1;
                } else if (selectedSede) {
                    critical = globals.Servicios_Espera_Critical || 0;
                    warning = globals.Servicios_Espera_Warning || 0;
                    total = globals.Total_Servicios || 1;
                } else {
                    critical = globals.Oficinas_Espera_Critical || 0;
                    warning = globals.Oficinas_Espera_Warning || 0;
                    total = globals.Total_Oficinas || 1;
                }
            }
        } else {
            // 'service': compare AvgServicio against per-row thresholds
            const unitRows: any[] = globals.Top_Unidades_Espera || [];
            if (unitRows.length > 0) {
                critical = unitRows.filter((r: any) => {
                    const val = Number(r.AvgServicio || 0);
                    const crit = Number(r.ServiceTimeCritical || 0);
                    return crit > 0 && val >= crit;
                }).length;
                warning = unitRows.filter((r: any) => {
                    const val = Number(r.AvgServicio || 0);
                    const warn = Number(r.ServiceTimeWarning || 0);
                    const crit = Number(r.ServiceTimeCritical || 0);
                    return warn > 0 && val >= warn && (crit === 0 || val < crit);
                }).length;
                total = unitRows.length;
            } else {
                // Fallback to backend aggregated
                if (selectedService) {
                    critical = globals.OficinasByService_Servicio_Critical || 0;
                    warning = globals.OficinasByService_Servicio_Warning || 0;
                    total = globals.OficinasByService_Total || 1;
                } else if (selectedSede) {
                    critical = globals.Servicios_Servicio_Critical || 0;
                    warning = globals.Servicios_Servicio_Warning || 0;
                    total = globals.Total_Servicios || 1;
                } else {
                    critical = globals.Oficinas_Servicio_Critical || 0;
                    warning = globals.Oficinas_Servicio_Warning || 0;
                    total = globals.Total_Oficinas || 1;
                }
            }
        }

        const criticalPct = total > 0 ? ((critical / total) * 100).toFixed(1) : '0.0';
        const warningPct = total > 0 ? ((warning / total) * 100).toFixed(1) : '0.0';

        return (
            <div className="flex gap-3 text-xs text-white/90 mt-2 justify-center">
                <span className="font-semibold">Crit. {critical} ({criticalPct}%)</span>
                <span className="font-semibold">Adv. {warning} ({warningPct}%)</span>
            </div>
        );
    };

    // Rankings Panel Component
    const RankingsPanel = () => {
        if (!globals) return null;

        const [activeTab, setActiveTab] = useState<'units' | 'services'>('units');
        const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

        // Auto-switch to services when a specific office/sede is selected
        useEffect(() => {
            if (selectedSede) {
                setActiveTab('services');
            } else {
                setActiveTab('units');
            }
        }, [selectedSede]);

        const toggleSection = (id: string) => {
            setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
        };

        const formatTime = (seconds: any) => {
            if (seconds === null || seconds === undefined || isNaN(Number(seconds))) return '00:00:00';
            const s = Number(seconds);
            const hrs = Math.floor(s / 3600);
            const mins = Math.floor((s % 3600) / 60);
            const secs = Math.floor(s % 60);
            return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        };

        const RankingSection = ({ title, items, type, isExpanded, onToggle }: { title: string; items: any[]; type: 'time' | 'volume'; isExpanded: boolean; onToggle: () => void }) => {
            if (!items || items.length === 0) return null;

            // Is this the UNIDADES combined "Espera y Servicio" section?
            const isUnidadesCombined = type === 'time' && !!items[0]?.Oficina;

            // Sort state — only used for isUnidadesCombined
            const [sortCol, setSortCol] = React.useState<'espera' | 'servicio'>('espera');
            const [sortDir, setSortDir] = React.useState<'desc' | 'asc'>('desc');

            const handleSortClick = (col: 'espera' | 'servicio') => {
                if (sortCol === col) {
                    setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                } else {
                    setSortCol(col);
                    setSortDir('desc');
                }
            };

            const sortArrow = (col: 'espera' | 'servicio') => {
                if (!isUnidadesCombined || sortCol !== col) return ' ↕';
                return sortDir === 'desc' ? ' ↓' : ' ↑';
            };

            // For UNIDADES combined: sort client-side
            const resolvedItems = isUnidadesCombined
                ? [...items].sort((a, b) => {
                    const key = sortCol === 'espera' ? 'AvgEspera' : 'AvgServicio';
                    return sortDir === 'desc' ? (b[key] || 0) - (a[key] || 0) : (a[key] || 0) - (b[key] || 0);
                })
                : items;

            return (
                <div className="mb-1 lg:mb-2 2xl:mb-6">
                    <h4 className="text-sm font-black text-slate-800 mb-0.5 lg:mb-1 2xl:mb-3 px-1 flex items-center justify-between">
                        <span>{title}</span>
                        <span
                            className="text-blue-600 text-[10px] font-bold cursor-pointer hover:underline tracking-tight"
                            onClick={onToggle}
                        >
                            {isExpanded ? '- Ver menos' : '+ Ver más'}
                        </span>
                    </h4>

                    {/* Table Header */}
                    <div className="flex items-center px-1 pb-1.5 border-b border-slate-100 text-[9px] 2xl:text-[11px] font-bold text-slate-400 uppercase tracking-tight">
                        <div className="flex-1">Nombre</div>
                        <div
                            className={`shrink-0 text-right px-2 ${type === 'time' ? 'w-[60px] 2xl:w-[75px]' : 'w-[85px] 2xl:w-[100px]'} ${isUnidadesCombined ? 'cursor-pointer hover:text-blue-500 select-none' : ''}`}
                            onClick={() => isUnidadesCombined && handleSortClick('espera')}
                        >
                            {type === 'time' ? (isUnidadesCombined ? `Espera${sortArrow('espera')}` : 'Tiempo') : 'Valor'}
                        </div>
                        {/* UNIDADES: show Servicio col; SERVICIOS: show Promesa col */}
                        {type === 'time' && (
                            isUnidadesCombined
                                ? <div
                                    className="shrink-0 w-[60px] 2xl:w-[75px] text-right cursor-pointer hover:text-blue-500 select-none"
                                    onClick={() => handleSortClick('servicio')}
                                >Atencion{sortArrow('servicio')}</div>
                                : <div className="shrink-0 w-[60px] 2xl:w-[75px] text-right">Promesa</div>
                        )}
                        <div className="shrink-0 w-[50px] 2xl:w-[65px] text-right px-1">% Obj</div>
                    </div>

                    <div className="space-y-0.5">
                        {(isExpanded ? resolvedItems : resolvedItems.slice(0, 4)).map((item: any, index: number) => {
                            const name = item.Oficina || item.Servicio || 'Desconocido';
                            // isServicio is true ONLY for purely-service sections (not the combined Espera+Service)
                            const isServicio = title.includes('Servicio') && !title.includes('Volumen') && !title.includes('Abandonos') && !title.includes('Espera');

                            // Pick the correct raw metric for this section
                            const rawValue = type !== 'time'
                                ? (item.TotalVolumen || item.TotalAbandonos || 0)
                                : isServicio
                                    ? (item.AvgServicio || 0)
                                    : (item.AvgEspera || 0);

                            // Pick thresholds appropriate for this section (Espera vs Servicio)
                            const standard = isServicio
                                ? (item.ServiceTimeStandard ?? item.serviceTimeStandard ?? null)
                                : (item.WaitingTimeStandard ?? item.waitingTimeStandard ?? null);
                            const warn = isServicio
                                ? (item.ServiceTimeWarning ?? item.serviceTimeWarning ?? null)
                                : (item.WaitingTimeWarning ?? item.waitingTimeWarning ?? null);
                            const crit = isServicio
                                ? (item.ServiceTimeCritical ?? item.serviceTimeCritical ?? null)
                                : (item.WaitingTimeCritical ?? item.waitingTimeCritical ?? null);

                            // Promesa: show Standard goal, fall back to Critical, then Warning
                            const promiseValue = standard || crit || warn || 0;

                            const getStatusClass = () => {
                                if (type !== 'time') return 'text-[#727D84] font-medium';
                                // RED: above critical
                                if (crit && rawValue >= crit) return 'bg-[#F15B4E] text-white shadow-sm px-1 rounded font-bold';
                                // YELLOW: above warning
                                if (warn && rawValue >= warn) return 'bg-[#F1DB51] text-slate-900 shadow-sm px-1 rounded font-bold';
                                // Fallback: only standard defined → treat as warning-level alert
                                if (!crit && !warn && standard && rawValue >= standard) return 'bg-[#F1DB51] text-slate-900 shadow-sm px-1 rounded font-bold';
                                return 'text-slate-900 font-bold';
                            };

                            if (index < 1) {
                                console.log(`[${title}][${name}] keys:`, Object.keys(item), 'vals:', item);
                            }

                            return (
                                <div
                                    key={index}
                                    className="flex items-center py-0.5 lg:py-1 2xl:py-2 px-1 border-b border-slate-50 hover:bg-blue-50/60 transition-colors group cursor-pointer"
                                    onClick={() => {
                                        if (item.Oficina) {
                                            // Unit row → filter by sede
                                            setSelectedSede(item.Oficina);
                                            setSedeSearch(item.Oficina);
                                            setSelectedService('');
                                            setServiceSearch('');
                                            setShowSedeDropdown(false);
                                            setShowServiceDropdown(false);
                                        } else if (item.Servicio) {
                                            // Service row → filter by service
                                            setSelectedService(item.Servicio);
                                            setServiceSearch(item.Servicio);
                                            setShowServiceDropdown(false);
                                        }
                                    }}
                                    title={item.Oficina ? `Filtrar por unidad: ${name}` : `Filtrar por servicio: ${name}`}
                                >
                                    <span className="text-slate-400 font-bold ml-1 mr-2 text-[9px]">#{index + 1}</span>
                                    <div className="flex-1 min-w-0 pr-1">
                                        <span className="text-[10px] 2xl:text-xs font-bold text-[#0055c4] truncate block group-hover:underline" title={name}>
                                            {name}
                                        </span>
                                    </div>
                                    <div className={`shrink-0 text-right px-1 ${type === 'time' ? 'w-[60px] 2xl:w-[75px]' : 'w-[85px] 2xl:w-[100px]'}`}>
                                        <div className={`text-[10px] 2xl:text-xs font-mono ${getStatusClass()}`}>
                                            {type === 'time' ? formatDuration(rawValue) : rawValue.toLocaleString()}
                                        </div>
                                    </div>
                                    {type === 'time' && (
                                        item.Oficina
                                            ? (() => {
                                                // UNIDADES: show Atencion (AvgServicio) with ServiceTime colorimetry
                                                const svcVal = item.AvgServicio || 0;
                                                const svcCrit = item.ServiceTimeCritical ?? item.serviceTimeCritical ?? null;
                                                const svcWarn = item.ServiceTimeWarning ?? item.serviceTimeWarning ?? null;
                                                const svcStd = item.ServiceTimeStandard ?? item.serviceTimeStandard ?? null;
                                                const svcClass = (() => {
                                                    if (svcCrit && svcVal >= svcCrit) return 'bg-[#F15B4E] text-white shadow-sm px-1 rounded font-bold';
                                                    if (svcWarn && svcVal >= svcWarn) return 'bg-[#F1DB51] text-slate-900 shadow-sm px-1 rounded font-bold';
                                                    if (!svcCrit && !svcWarn && svcStd && svcVal >= svcStd) return 'bg-[#F1DB51] text-slate-900 shadow-sm px-1 rounded font-bold';
                                                    return 'text-[#727D84] font-medium';
                                                })();
                                                return (
                                                    <div className="shrink-0 w-[60px] 2xl:w-[75px] text-right pr-1">
                                                        <span className={`text-[10px] 2xl:text-xs font-mono ${svcClass}`}>
                                                            {formatDuration(svcVal)}
                                                        </span>
                                                    </div>
                                                );
                                            })()
                                            : (
                                                // SERVICIOS: keep Promesa column
                                                <div className="shrink-0 w-[60px] 2xl:w-[75px] text-right">
                                                    <span className="text-[10px] 2xl:text-xs font-medium text-[#727D84] font-mono opacity-80">
                                                        {formatDuration(promiseValue)}
                                                    </span>
                                                </div>
                                            )
                                    )}
                                    <div className="shrink-0 w-[50px] 2xl:w-[65px] text-right px-1">
                                        <span className="text-[9px] 2xl:text-[11px] font-medium text-[#727D84]">
                                            {item.PorcentajeEnObjetivo !== undefined ? `${item.PorcentajeEnObjetivo}%` : '--%'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        };

        return (
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-xl shadow-slate-200/50 h-full overflow-hidden flex flex-col">
                {/* Tabs */}
                <div className="flex bg-slate-100 p-1 rounded-2xl mb-4 flex-shrink-0 border border-slate-200/50 h-9">
                    <button
                        onClick={() => setActiveTab('units')}
                        className={`flex-1 h-full flex items-center justify-center rounded-xl text-[11px] font-black uppercase tracking-wider transition-all leading-none ${activeTab === 'units'
                            ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/50'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                            }`}
                    >
                        Unidades
                    </button>
                    <button
                        onClick={() => setActiveTab('services')}
                        className={`flex-1 h-full flex items-center justify-center rounded-xl text-[11px] font-black uppercase tracking-wider transition-all leading-none ${activeTab === 'services'
                            ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/50'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                            }`}
                    >
                        Servicios
                    </button>
                </div>

                {/* Rankings */}
                <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-100 scrollbar-track-transparent">
                    {activeTab === 'units' ? (
                        <div className="space-y-4">
                            <RankingSection
                                title="⏱️ Mayor Tiempo de Espera y Atencion"
                                items={globals.Top_Unidades_Espera || []}
                                type="time"
                                isExpanded={!!expandedSections['u_wait']}
                                onToggle={() => toggleSection('u_wait')}
                            />

                            <RankingSection
                                title="📊 Mayor Volumen"
                                items={globals.Top_Unidades_Volumen || []}
                                type="volume"
                                isExpanded={!!expandedSections['u_vol']}
                                onToggle={() => toggleSection('u_vol')}
                            />
                            <RankingSection
                                title="⚠️ Mayor Abandonos"
                                items={globals.Top_Unidades_Abandonos || []}
                                type="volume"
                                isExpanded={!!expandedSections['u_ab']}
                                onToggle={() => toggleSection('u_ab')}
                            />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <RankingSection
                                title="⏱️ Mayor Tiempo de Espera"
                                items={globals.Top_Servicios_Espera || []}
                                type="time"
                                isExpanded={!!expandedSections['s_wait']}
                                onToggle={() => toggleSection('s_wait')}
                            />
                            <RankingSection
                                title="🔧 Mayor Tiempo de Atención"
                                items={globals.Top_Servicios_Servicio || []}
                                type="time"
                                isExpanded={!!expandedSections['s_service']}
                                onToggle={() => toggleSection('s_service')}
                            />
                            <RankingSection
                                title="📊 Mayor Volumen"
                                items={globals.Top_Servicios_Volumen || []}
                                type="volume"
                                isExpanded={!!expandedSections['s_vol']}
                                onToggle={() => toggleSection('s_vol')}
                            />
                            <RankingSection
                                title="⚠️ Mayor Abandonos"
                                items={globals.Top_Servicios_Abandonos || []}
                                type="volume"
                                isExpanded={!!expandedSections['s_ab']}
                                onToggle={() => toggleSection('s_ab')}
                            />
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const FinanceIndicator = ({ viewBox, value, color, unit = '' }: any) => {
        if (!viewBox || value === null || value === undefined) return null;
        const { x, width, y } = viewBox;

        let displayValue = '';
        if (unit === 'm' || unit === 's') {
            // Time formatting behavior: HH:mm:ss
            // Assuming value is in seconds based on chart scaling
            const totalSeconds = Math.round(value);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            const p = (n: number) => n.toString().padStart(2, '0');
            // If hours > 0, show HH:mm:ss, otherwise usually mm:ss is enough but user asked for 00:00:00 format implication
            // User requested "00:00:00" format specifically.
            displayValue = `${p(hours)}:${p(minutes)}:${p(seconds)}`;
        } else {
            // Number formatting: Thousands separators
            displayValue = Math.round(value).toLocaleString();
        }

        // Position indicators clearly outside the plot area, in the 80px margin
        // Moving to +15 to leave more room after the axis line
        const rightEdge = x + width;
        const xOffset = rightEdge + 15;
        const pillWidth = 55;

        return (
            <g>
                {/* Visual connector line */}
                <path d={`M ${rightEdge} ${y} L ${xOffset} ${y}`} stroke={color} strokeWidth={1} strokeDasharray="3 3" />
                {/* Value pill */}
                <rect x={xOffset} y={y - 12} width={pillWidth + 5} height={24} fill={color} rx={8} className="shadow-sm" />
                <text
                    x={xOffset + pillWidth / 2}
                    y={y + 4}
                    fill="#fff"
                    fontSize={11}
                    fontWeight="900"
                    textAnchor="middle"
                >
                    {displayValue}
                </text>
            </g>
        );
    };



    const handleLegendClick = (e: any) => {
        console.log('🖱️ Legend clicked:', e);
        const dataKey = e.value || e.dataKey;

        const lineMap: { [key: string]: keyof typeof visibleLines } = {
            'Volumen por Minuto': 'volumen',
            'Abandonos por Minuto': 'abandonos',
            'Tiempo prom de espera': 'espera',
            'Tiempo de atención promedio': 'servicio'
        };

        const key = lineMap[dataKey];
        if (key) {
            console.log('Toggling:', key, 'from', visibleLines[key], 'to', !visibleLines[key]);
            setVisibleLines(prev => ({
                ...prev,
                [key]: !prev[key]
            }));
        }
    };

    // Custom legend formatter to show opacity for hidden items
    const renderLegend = (value: string) => {
        const lineMap: { [key: string]: keyof typeof visibleLines } = {
            'Volumen por Minuto': 'volumen',
            'Abandonos por Minuto': 'abandonos',
            'Tiempo prom de espera': 'espera',
            'Tiempo de atención promedio': 'servicio'
        };
        const key = lineMap[value];
        const isVisible = key ? visibleLines[key] : true;

        return (
            <span style={{
                opacity: isVisible ? 1 : 0.3,
                textDecoration: isVisible ? 'none' : 'line-through'
            }}>
                {value}
            </span>
        );
    };

    const dataMaxTime = useMemo(() => {
        const sourceData = minuteData && (minuteData as any[]).length > 0 ? minuteData as any[] :
            hourData && (hourData as any[]).length > 0 ? hourData as any[] : [];
        if (sourceData.length > 0) {
            const maxTimeStr = sourceData.reduce((max: string, curr: any) =>
                curr.Hora_Minuto > max ? curr.Hora_Minuto : max, '00:00');
            if (maxTimeStr > '00:00') {
                return maxTimeStr;
            }
        }
        return lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, [minuteData, hourData, lastUpdate]);

    // Grouping logic for summary view
    const groupedData = useMemo(() => {
        if (waitingDrillView !== 'summary') return [];
        const groups: Record<string, number> = {};
        waitingDrillData.forEach(ticket => {
            const srv = ticket.ServiceName || 'Indefinido';
            groups[srv] = (groups[srv] || 0) + 1;
        });
        return Object.entries(groups)
            .map(([service, count]) => ({ service, count }))
            .sort((a, b) => b.count - a.count);
    }, [waitingDrillData, waitingDrillView]);

    const groupedServiceData = useMemo(() => {
        if (serviceDrillView !== 'summary') return [];
        const groups: Record<string, number> = {};
        serviceDrillData.forEach(ticket => {
            const srv = ticket.ServiceName || 'Indefinido';
            groups[srv] = (groups[srv] || 0) + 1;
        });
        return Object.entries(groups)
            .map(([service, count]) => ({ service, count }))
            .sort((a, b) => b.count - a.count);
    }, [serviceDrillData, serviceDrillView]);

    return (
        <>
            <div className="h-full flex flex-col pt-0 px-2 pb-1 space-y-0 overflow-hidden">
                <div className="flex flex-row justify-between items-center gap-1 mb-0">
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col justify-center leading-none">
                            <h2 className="text-lg 2xl:text-3xl font-black text-slate-800 flex items-center gap-1.5 2xl:gap-2">
                                <span className="relative flex h-2 w-2 2xl:h-4 2xl:w-4">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#A3CF62] opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 2xl:h-4 2xl:w-4 bg-[#A3CF62]"></span>
                                </span>
                                Monitoreo en Vivo
                            </h2>
                            <p className="text-slate-500 text-[9px] 2xl:text-base font-medium">
                                <span className="mr-1.5 opacity-75">Última actualización</span>
                                <span className="font-bold">{selectedDate.split('-').reverse().join('/')}</span>
                                <span className="mx-1 opacity-50">•</span>
                                <span className="font-bold">{dataMaxTime}</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3 items-center">


                        {/* Searchable Sede Filter */}
                        <div className="relative">
                            <input
                                type="text"
                                value={sedeSearch}
                                onChange={(e) => {
                                    setSedeSearch(e.target.value);
                                    setShowSedeDropdown(true);
                                }}
                                onFocus={() => setShowSedeDropdown(true)}
                                placeholder={selectedSede || "Buscar sede..."}
                                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm 2xl:text-base font-bold text-slate-700 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none w-64 2xl:w-80"
                            />
                            {showSedeDropdown && (
                                <div className="absolute z-50 mt-1 w-64 2xl:w-80 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                    <div
                                        onClick={() => {
                                            setSelectedSede('');
                                            setSedeSearch('');
                                            setShowSedeDropdown(false);
                                        }}
                                        className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm 2xl:text-base font-bold text-blue-600"
                                    >
                                        📊 Todas las Sedes (Totales)
                                    </div>
                                    {sedes
                                        .filter(s => s.toLowerCase().includes(sedeSearch.toLowerCase()))
                                        .map(sede => (
                                            <div
                                                key={sede}
                                                onClick={() => {
                                                    setSelectedSede(sede);
                                                    setSedeSearch('');
                                                    setShowSedeDropdown(false);
                                                }}
                                                className="px-4 py-2 hover:bg-slate-50 cursor-pointer text-sm 2xl:text-base"
                                            >
                                                {sede}
                                            </div>
                                        ))
                                    }
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => {
                                fetchLiveData('hour');
                                fetchLiveData('minute');
                            }}
                            disabled={isLoading}
                            className="px-4 py-2 text-white rounded-xl text-sm 2xl:text-base font-bold transition-all shadow-lg disabled:opacity-50"
                            style={{ background: isLoading ? '#93c5fd' : '#2D75AA', boxShadow: '0 4px 14px rgba(45,117,170,0.35)' }}
                        >
                            {isLoading ? 'Cargando...' : 'Actualizar'}
                        </button>

                        {/* User profile button */}
                        {user && (
                            <div style={{ position: 'relative' }}>
                                <button
                                    onClick={() => setShowUserMenu(prev => !prev)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        background: '#2D75AA', border: 'none', borderRadius: '12px',
                                        padding: '6px 12px 6px 6px', cursor: 'pointer',
                                        boxShadow: '0 2px 8px rgba(45,117,170,0.30)',
                                    }}
                                >
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '50%',
                                        background: 'rgba(255,255,255,0.25)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                        fontSize: '12px', fontWeight: 900, color: '#fff',
                                    }}>
                                        {user.nombre?.charAt(0)?.toUpperCase() || 'U'}
                                    </div>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {user.nombre}
                                    </span>
                                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d={showUserMenu ? 'M4.5 15.75l7.5-7.5 7.5 7.5' : 'M19.5 8.25l-7.5 7.5-7.5-7.5'} />
                                    </svg>
                                </button>

                                {showUserMenu && (
                                    <div style={{
                                        position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                                        background: '#fff', borderRadius: '14px',
                                        boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
                                        border: '1px solid #f1f5f9', minWidth: '200px', zIndex: 999,
                                        overflow: 'hidden', fontFamily: "'Inter', sans-serif",
                                    }}>
                                        <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg,#1B6DB5,#2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 900, color: '#fff', flexShrink: 0 }}>
                                                    {user.nombre?.charAt(0)?.toUpperCase() || 'U'}
                                                </div>
                                                <div>
                                                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>{user.nombre}</p>
                                                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 8px', borderRadius: '20px', background: user.rol === 'admin' ? '#eff6ff' : '#f0fdf4', color: user.rol === 'admin' ? '#1d4ed8' : '#15803d' }}>
                                                        {user.rol?.toUpperCase()}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {user.rol === 'admin' && onOpenAdmin && (
                                            <button
                                                onClick={() => { setShowUserMenu(false); onOpenAdmin(); }}
                                                style={{ width: '100%', padding: '11px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: '8px' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                            >
                                                ⚙️ Administración de usuarios
                                            </button>
                                        )}

                                        {onLogout && (
                                            <button
                                                onClick={() => { setShowUserMenu(false); onLogout(); }}
                                                style={{ width: '100%', padding: '11px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#dc2626', display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid #f1f5f9' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#fff1f0')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                            >
                                                🔓 Cerrar Sesión
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {error && (
                    <div className="bg-[#fff1f0] border-l-4 border-[#F15B4E] p-4 rounded-xl">
                        <p className="text-[#F15B4E] font-bold text-sm">Error: {error}</p>
                        <p className="text-[10px] text-[#F15B4E]/60 mt-1 uppercase font-black">Consulte la consola para detalles técnicos</p>
                    </div>
                )}

                {/* Loading Overlay */}
                {isLoading && (
                    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center">
                        <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
                            <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-200 border-t-blue-600"></div>
                            <p className="text-lg font-bold text-slate-700">Cargando datos...</p>
                            <p className="text-sm text-slate-500">Fecha: {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                        </div>
                    </div>
                )}

                {/* KPI Summary Cards - Integrated Main Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1.5 lg:gap-2 2xl:gap-3" style={{ marginBottom: '8px' }}>
                    {/* Volumen Total: Compact Horizontal Layout */}
                    <div className="min-w-0 bg-white p-2 2xl:p-2 rounded-lg border border-slate-100 shadow-lg flex flex-col justify-between h-full">
                        {/* Top Section: Number + Label */}
                        <div className="flex items-center justify-between mb-0.5">
                            <div className="flex items-center gap-2">
                                <p className="text-sm lg:text-sm 2xl:text-xl font-black text-[#002B49] leading-none">
                                    {(() => {
                                        const total = globals ? (selectedSede ? (globals.GlobalOficina_TotalTurnos || 0) : (globals.Global_TotalTurnos || 0)) : dailyStats.volumenTotal;
                                        return total.toLocaleString();
                                    })()}
                                </p>
                                <p className="text-[9px] lg:text-[9px] 2xl:text-[13px] font-black text-[#727D84] tracking-wider leading-none pt-1">
                                    Volumen total
                                </p>
                            </div>
                        </div>

                        {/* Linear Progress Bar */}
                        <div className="w-full h-1.5 bg-[#F15B4E]/10 rounded-full overflow-hidden mt-0.5 mb-1 flex">
                            {(() => {
                                const total = globals ? (selectedSede ? (globals.GlobalOficina_TotalTurnos || 0) : (globals.Global_TotalTurnos || 0)) : dailyStats.volumenTotal;
                                const atendidos = globals ? (selectedSede ? (globals.GlobalOficina_Atendidos || 0) : (globals.Global_Atendidos || 0)) : (dailyStats.volumenTotal - dailyStats.abandonosTotal);
                                const atendidosPct = total > 0 ? (atendidos / total) * 100 : 0;
                                return (
                                    <div
                                        className="h-full bg-[#A3CF62] rounded-full transition-all duration-1000"
                                        style={{ width: `${atendidosPct}%` }}
                                    />
                                );
                            })()}
                        </div>

                        {/* Footer Dots and Values with Percentages */}
                        <div className="flex items-center justify-between px-0.5">
                            {(() => {
                                const total = globals ? (selectedSede ? (globals.GlobalOficina_TotalTurnos || 0) : (globals.Global_TotalTurnos || 0)) : dailyStats.volumenTotal;
                                const atendidos = globals ? (selectedSede ? (globals.GlobalOficina_Atendidos || 0) : (globals.Global_Atendidos || 0)) : (dailyStats.volumenTotal - dailyStats.abandonosTotal);
                                const abandonos = dailyStats.abandonosTotal;
                                const atendidosPct = total > 0 ? Math.round((atendidos / total) * 100) : 0;
                                const abandonosPct = total > 0 ? Math.round((abandonos / total) * 100) : 0;

                                return (
                                    <>
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-2 h-2 rounded-full bg-[#A3CF62]"></div>
                                            <p className="text-[10px] 2xl:text-xs font-bold text-slate-500">
                                                Atendidos <span className="font-medium text-slate-700">{atendidos.toLocaleString()} ({atendidosPct}%)</span>
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <p className="text-[10px] 2xl:text-xs font-bold text-slate-500">
                                                Abandonos <span className="font-medium text-slate-700">{abandonos.toLocaleString()} ({abandonosPct}%)</span>
                                            </p>
                                            <div className="w-2 h-2 rounded-full bg-[#F15B4E]"></div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Grouped KPI Card 1: En espera & % Objetivo */}
                    <div className="min-w-0 bg-white rounded-lg border border-slate-100 shadow-lg shadow-slate-200/50 flex flex-col overflow-hidden h-full">
                        <div
                            className="flex items-center justify-between px-1.5 lg:px-2 2xl:px-2.5 py-1.5 2xl:py-2 border-b border-slate-50 flex-1 cursor-pointer hover:bg-blue-50 rounded-t-lg transition-colors group"
                            onClick={() => setShowWaitingModal(true)}
                            title="Ver detalle por unidad"
                        >
                            <span className="text-[9px] lg:text-[9px] 2xl:text-[13px] font-black text-[#727D84] tracking-tight 2xl:tracking-wider leading-none pt-1 group-hover:text-blue-600 transition-colors whitespace-nowrap">En espera</span>
                            <span className="text-xs lg:text-sm 2xl:text-xl font-black text-slate-800 leading-none">
                                {(globals?.CurrentlyWaiting || 0).toLocaleString('es-CO')}
                            </span>
                        </div>
                        <div
                            className="flex items-center justify-between px-1.5 lg:px-2 2xl:px-2.5 py-1.5 2xl:py-2 flex-1 cursor-pointer hover:bg-green-50 rounded-b-lg transition-colors group"
                            onClick={() => setShowObjetivoModal(true)}
                            title="Ver porcentaje de objetivo por unidad"
                        >
                            <span className="text-[9px] lg:text-[9px] 2xl:text-[13px] font-black text-[#727D84] tracking-tight 2xl:tracking-wider leading-none pt-1 group-hover:text-[#8eb355] transition-colors whitespace-nowrap">% Objetivo</span>
                            <span className="text-xs lg:text-sm 2xl:text-xl font-black text-[#8eb355] leading-none">
                                {(() => {
                                    const val = selectedService ? (globals?.Servicio_PorcentajeEsperaEnObjetivo) :
                                        selectedSede ? (globals?.Oficina_PorcentajeEsperaEnObjetivo) :
                                            (globals?.Global_PorcentajeEsperaEnObjetivo);
                                    return val !== undefined ? `${Math.round(val)}%` : '--%';
                                })()}
                            </span>
                        </div>
                    </div>

                    {/* Grouped KPI Card 2: Máx espera & Máx servicio */}
                    <div className="min-w-0 bg-white rounded-lg border border-slate-100 shadow-lg shadow-slate-200/50 flex flex-col overflow-hidden h-full">
                        <div
                            className="flex items-center justify-between px-1.5 lg:px-2 2xl:px-2.5 py-1.5 2xl:py-2 border-b border-slate-50 flex-1 cursor-pointer hover:bg-amber-50 rounded-t-lg transition-colors group"
                            onClick={() => setShowMaxWaitModal(true)}
                            title="Ver máximo tiempo de espera por unidad"
                        >
                            <span className="text-[9px] lg:text-[9px] 2xl:text-[13px] font-black text-[#727D84] tracking-tight 2xl:tracking-wider leading-none pt-1 group-hover:text-amber-600 transition-colors whitespace-nowrap">Máx espera</span>
                            <span className="text-xs lg:text-sm 2xl:text-xl font-black text-slate-700 leading-none">
                                {(() => {
                                    const time = globals?.MaxWaitingTime || '00:00:00';
                                    return time.split(':').length === 3 && time.indexOf(':') === 1 ? `0${time}` : time;
                                })()}
                            </span>
                        </div>
                        <div
                            className="flex items-center justify-between px-1.5 lg:px-2 2xl:px-2.5 py-1.5 2xl:py-2 flex-1 cursor-pointer hover:bg-indigo-50 rounded-b-lg transition-colors group"
                            onClick={() => setShowMaxServiceModal(true)}
                            title="Ver máximo tiempo de servicio por unidad"
                        >
                            <span className="text-[9px] lg:text-[9px] 2xl:text-[13px] font-black text-[#727D84] tracking-tight 2xl:tracking-wider leading-none pt-1 group-hover:text-indigo-600 transition-colors whitespace-nowrap">Máx atención</span>
                            <span className="text-xs lg:text-sm 2xl:text-xl font-black text-indigo-500 leading-none">
                                {(() => {
                                    const time = globals?.MaxServiceTime || '00:00:00';
                                    return time.split(':').length === 3 && time.indexOf(':') === 1 ? `0${time}` : time;
                                })()}
                            </span>
                        </div>
                    </div>

                    {/* Espera promedio */}
                    <div className={`min-w-0 bg-gradient-to-br ${getWaitTimeCardColor()} p-2 rounded-lg shadow-lg text-center flex flex-col justify-center border border-white/20`}>
                        <p className="text-[9px] lg:text-[9px] 2xl:text-[13px] font-black text-white tracking-wider mb-0.5 leading-none">Espera prom.</p>
                        <p className="text-sm lg:text-sm 2xl:text-xl font-black text-white leading-none">
                            {formatDuration(dailyStats.esperaProm)}
                        </p>
                        {renderStatusCounters('wait')}
                    </div>

                    {/* Servicio promedio */}
                    <div className={`min-w-0 bg-gradient-to-br ${getServiceTimeCardColor()} p-2 rounded-lg shadow-lg text-center flex flex-col justify-center border border-white/20`}>
                        <p className="text-[9px] lg:text-[9px] 2xl:text-[13px] font-black text-white tracking-wider mb-0.5 leading-none">Atención prom.</p>
                        <p className="text-sm lg:text-sm 2xl:text-xl font-black text-white leading-none">
                            {formatDuration(dailyStats.servicioProm)}
                        </p>
                        {renderStatusCounters('service')}
                    </div>
                </div>

                {/* Other Real-time Agent Metrics - Movidos a la fila superior */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1.5 lg:gap-2 2xl:gap-3" style={{ marginBottom: '10px' }}>
                    <div
                        className="min-w-0 bg-white p-2 2xl:p-3 rounded-lg border border-slate-100 shadow-lg shadow-slate-200/40 flex items-center justify-between px-1.5 lg:px-2 2xl:px-3 cursor-pointer hover:bg-slate-50 transition-colors group"
                        onClick={() => setAgentModalType('AgentsSignedIn')}
                        title="Ver agentes logueados por unidad"
                    >
                        <p className="text-[10px] lg:text-[10px] 2xl:text-[13px] font-black text-[#727D84] tracking-none leading-none group-hover:text-blue-500 transition-colors">Agentes log. <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-[12px] h-[12px] inline-block ml-0.5 -mt-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" /></svg></p>
                        <p className="text-sm lg:text-sm 2xl:text-lg font-black text-[#00A1DF] leading-none pt-0.5">{globals?.AgentsSignedIn || 0}</p>
                    </div>
                    <div
                        className="min-w-0 bg-white p-2 2xl:p-3 rounded-lg border border-slate-100 shadow-lg shadow-slate-200/40 flex items-center justify-between px-1.5 lg:px-2 2xl:px-3 cursor-pointer hover:bg-slate-50 transition-colors group"
                        onClick={() => setAgentModalType('AgentsInService')}
                        title="Ver agentes en atención por unidad"
                    >
                        <p className="text-[10px] lg:text-[10px] 2xl:text-[13px] font-black text-[#727D84] tracking-none leading-none group-hover:text-[#8eb355] transition-colors">En atención <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-[12px] h-[12px] inline-block ml-0.5 -mt-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" /></svg></p>
                        <p className="text-sm lg:text-sm 2xl:text-lg font-black text-[#A3CF62] leading-none pt-0.5">{globals?.AgentsInService || 0}</p>
                    </div>
                    <div
                        className="min-w-0 bg-white p-2 2xl:p-3 rounded-lg border border-slate-100 shadow-lg shadow-slate-200/40 flex items-center justify-between px-1.5 lg:px-2 2xl:px-3 cursor-pointer hover:bg-slate-50 transition-colors group"
                        onClick={() => setAgentModalType('AgentsIdle')}
                        title="Ver agentes inactivos por unidad"
                    >
                        <p className="text-[10px] lg:text-[10px] 2xl:text-[13px] font-black text-[#727D84] tracking-none leading-none group-hover:text-[#8eb355] transition-colors">Inactivos <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-[12px] h-[12px] inline-block ml-0.5 -mt-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" /></svg></p>
                        <p className="text-sm lg:text-sm 2xl:text-lg font-black text-[#A3CF62] leading-none pt-0.5">{globals?.AgentsIdle || 0}</p>
                    </div>
                    <div
                        className="min-w-0 bg-white p-2 2xl:p-3 rounded-lg border border-slate-100 shadow-lg shadow-slate-200/40 flex items-center justify-between px-1.5 lg:px-2 2xl:px-3 cursor-pointer hover:bg-slate-50 transition-colors group"
                        onClick={() => setAgentModalType('AgentsInBackOffice')}
                        title="Ver agentes en backoffice por unidad"
                    >
                        <p className="text-[10px] lg:text-[10px] 2xl:text-[13px] font-black text-[#727D84] tracking-none leading-none group-hover:text-orange-500 transition-colors">Backoffice <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-[12px] h-[12px] inline-block ml-0.5 -mt-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" /></svg></p>
                        <p className="text-sm lg:text-sm 2xl:text-lg font-black text-orange-500 leading-none pt-0.5">{globals?.AgentsInBackOffice || 0}</p>
                    </div>
                    <div
                        className="min-w-0 bg-white p-2 2xl:p-3 rounded-lg border border-slate-100 shadow-lg shadow-slate-200/40 flex items-center justify-between px-1.5 lg:px-2 2xl:px-3 cursor-pointer hover:bg-slate-50 transition-colors group"
                        onClick={() => setAgentModalType('AgentsInReception')}
                        title="Ver agentes en recepción por unidad"
                    >
                        <p className="text-[10px] lg:text-[10px] 2xl:text-[13px] font-black text-[#727D84] tracking-none leading-none group-hover:text-purple-500 transition-colors">Recepción <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-[12px] h-[12px] inline-block ml-0.5 -mt-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" /></svg></p>
                        <p className="text-sm lg:text-sm 2xl:text-lg font-black text-purple-500 leading-none pt-0.5">{globals?.AgentsInReception || 0}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-1.5 lg:gap-2 2xl:gap-6 flex-1 min-h-0 pb-1">
                    {/* Área Gráfica */}
                    <div className="lg:col-span-8 2xl:col-span-9 h-full min-h-[400px]">
                        <div className="bg-white p-1 lg:p-1.5 2xl:p-5 rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/40 flex flex-col relative h-full">
                            {/* Loading Overlay */}
                            {isLoading && (
                                <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-3xl">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-blue-600 font-black text-[10px] uppercase tracking-widest">Sincronizando...</span>
                                    </div>
                                </div>
                            )}
                            <h3 className="text-sm 2xl:text-lg font-bold text-slate-800 mb-0 flex items-center gap-2 leading-none shrink-0" style={{ height: '22px' }}>
                                📈 Evolución Temporal
                            </h3>
                            <div
                                ref={chartRef}
                                className="w-full flex-1 min-h-0 relative"
                                style={{
                                    // grab hand when zoomed in to hint panning is available
                                    cursor: isPanning ? 'grabbing' : zoomRange.start > 0 ? 'grab' : 'crosshair',
                                    minHeight: '400px',
                                    userSelect: 'none'
                                }}
                                onDoubleClick={handleDoubleClick}
                                onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
                                    setIsPanning(true);
                                    setPanStart(e.clientX);
                                }}
                                onMouseUp={() => setIsPanning(false)}
                                onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const x = e.clientX - rect.left;
                                    const y = e.clientY - rect.top;
                                    // Update ref synchronously so wheel handler always has fresh coords
                                    mousePosRef.current = { x, chartWidth: rect.width };
                                    setMousePos({ x, y, visible: !isPanning });

                                    // Native panning — shift zoomRange proportional to drag distance
                                    if (isPanning) {
                                        const dragDeltaPx = e.clientX - panStart;
                                        const chartWidthPx = rect.width || 800;
                                        // Convert pixel drag to % of full dataset
                                        const deltaPercent = (dragDeltaPx / chartWidthPx) * (zoomRange.end - zoomRange.start);
                                        setZoomRange(prev => {
                                            let newStart = prev.start - deltaPercent;
                                            let newEnd = prev.end - deltaPercent;
                                            if (newStart < 0) { newEnd -= newStart; newStart = 0; }
                                            if (newEnd > 100) { newStart -= (newEnd - 100); newEnd = 100; }
                                            return { start: newStart, end: newEnd };
                                        });
                                        setPanStart(e.clientX); // reset anchor each frame
                                    }
                                }}
                                onMouseLeave={() => {
                                    setMousePos(prev => ({ ...prev, visible: false }));
                                    setIsPanning(false);
                                }}
                            >
                                {/* SVG Crosshair Overlay */}
                                {mousePos.visible && (
                                    <svg
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '100%',
                                            pointerEvents: 'none',
                                            zIndex: 10
                                        }}
                                    >
                                        {/* Vertical line */}
                                        <line
                                            x1={mousePos.x}
                                            y1={0}
                                            x2={mousePos.x}
                                            y2="100%"
                                            stroke="#1e40af"
                                            strokeWidth={1}
                                            strokeDasharray="5 4"
                                            opacity={0.6}
                                        />
                                        {/* Horizontal line */}
                                        <line
                                            x1={0}
                                            y1={mousePos.y}
                                            x2="100%"
                                            y2={mousePos.y}
                                            stroke="#1e40af"
                                            strokeWidth={1}
                                            strokeDasharray="5 4"
                                            opacity={0.6}
                                        />
                                        {/* Intersection dot */}
                                        <circle
                                            cx={mousePos.x}
                                            cy={mousePos.y}
                                            r={2.5}
                                            fill="#1e40af"
                                            opacity={0.75}
                                        />
                                    </svg>
                                )}
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart
                                        key={`${selectedSede}-${selectedService}-${zoomLevel}`}
                                        data={displayData}
                                        margin={{ bottom: 30, right: 20, top: 5, left: 10 }}
                                        onMouseMove={handleChartMouseMove}
                                        onMouseLeave={() => {
                                            setActivePoint(null);
                                            setIsPanning(false);
                                        }}
                                    >
                                        <defs>
                                            <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#A3CF62" stopOpacity={0.5} />
                                                <stop offset="95%" stopColor="#A3CF62" stopOpacity={0.05} />
                                            </linearGradient>
                                            <linearGradient id="colorEspera" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#2BB8CB" stopOpacity={0.5} />
                                                <stop offset="95%" stopColor="#2BB8CB" stopOpacity={0.05} />
                                            </linearGradient>
                                            <linearGradient id="colorServicio" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                                            </linearGradient>
                                            <linearGradient id="colorAbandonos" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#F15B4E" stopOpacity={0.5} />
                                                <stop offset="95%" stopColor="#F15B4E" stopOpacity={0.05} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            vertical={true}
                                            stroke="#e2e8f0"
                                            strokeOpacity={0.4}
                                        />
                                        <XAxis
                                            dataKey="Hora_Minuto"
                                            stroke="#94a3b8"
                                            fontSize={10}
                                            ticks={xTicks}
                                            tickFormatter={(val) => {
                                                return xTicks.includes(val) ? val : '';
                                            }}
                                            interval={0}
                                            height={20}
                                            tick={{ fill: '#94a3b8' }}
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            stroke="#94a3b8"
                                            fontSize={11}
                                            tickFormatter={(val) => {
                                                const h = Math.floor(val / 3600);
                                                const m = Math.floor((val % 3600) / 60);
                                                const s = Math.floor(val % 60);
                                                return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                                            }}
                                        />
                                        <YAxis
                                            yAxisId="right"
                                            orientation="right"
                                            stroke="#94a3b8"
                                            fontSize={11}
                                            tickFormatter={(val) => Math.round(val)}
                                        />
                                        <Tooltip cursor={false} content={<CustomTooltip />} />
                                        <Legend
                                            verticalAlign="top"
                                            height={36}
                                            wrapperStyle={{ fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                                            onClick={handleLegendClick}
                                            formatter={renderLegend}
                                            payload={[
                                                { value: 'Volumen por Minuto', type: 'circle', id: 'volumen', color: '#A3CF62' },
                                                { value: 'Abandonos por Minuto', type: 'circle', id: 'abandonos', color: '#F15B4E' },
                                                { value: 'Tiempo prom de espera', type: 'circle', id: 'espera', color: '#2BB8CB' },
                                                { value: 'Tiempo de atención promedio', type: 'circle', id: 'servicio', color: '#3b82f6' }
                                            ]}
                                        />

                                        <Area
                                            yAxisId="right"
                                            type="linear"
                                            dataKey="DisplayVolumen"
                                            name="Volumen por Minuto"
                                            stroke="#A3CF62"
                                            fillOpacity={0.4}
                                            fill="url(#colorVolume)"
                                            strokeWidth={1}
                                            hide={!visibleLines.volumen}
                                            connectNulls={false}
                                        />
                                        <Area
                                            yAxisId="right"
                                            type="linear"
                                            dataKey="DisplayAbandonos"
                                            name="Abandonos por Minuto"
                                            stroke="#F15B4E"
                                            fillOpacity={0.4}
                                            fill="url(#colorAbandonos)"
                                            strokeWidth={1}
                                            hide={!visibleLines.abandonos}
                                            connectNulls={false}
                                        />
                                        <Area
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="RunningEspera"
                                            name="Tiempo prom de espera"
                                            stroke="#2BB8CB"
                                            fillOpacity={0.4}
                                            fill="url(#colorEspera)"
                                            strokeWidth={2}
                                            hide={!visibleLines.espera}
                                            connectNulls={false}
                                        />
                                        <Area
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="RunningServicio"
                                            name="Tiempo de atención promedio"
                                            stroke="#3b82f6"
                                            fillOpacity={0.4}
                                            fill="url(#colorServicio)"
                                            strokeWidth={2}
                                            hide={!visibleLines.servicio}
                                            connectNulls={false}
                                        />

                                        {/* No ReferenceLine crosshair here — using SVG overlay instead */}

                                        {/* Current Value Indicators (Yahoo Finance Style) for all metrics */}
                                        {lastPoints.volumen !== null && visibleLines.volumen && (
                                            <ReferenceLine
                                                yAxisId="right"
                                                y={lastPoints.volumen}
                                                stroke="#A3CF62"
                                                strokeDasharray="3 3"
                                                strokeWidth={1}
                                                label={(props: any) => (
                                                    <FinanceIndicator {...props} color="#A3CF62" value={lastPoints.volumen} />
                                                )}
                                            />
                                        )}
                                        {lastPoints.abandonos !== null && visibleLines.abandonos && (
                                            <ReferenceLine
                                                yAxisId="right"
                                                y={lastPoints.abandonos}
                                                stroke="#F15B4E"
                                                strokeDasharray="3 3"
                                                strokeWidth={1}
                                                label={(props: any) => (
                                                    <FinanceIndicator {...props} color="#F15B4E" value={lastPoints.abandonos} />
                                                )}
                                            />
                                        )}
                                        {lastPoints.espera !== null && visibleLines.espera && (
                                            <ReferenceLine
                                                yAxisId="left"
                                                y={lastPoints.espera}
                                                stroke="#2BB8CB"
                                                strokeDasharray="3 3"
                                                strokeWidth={1}
                                                label={(props: any) => (
                                                    <FinanceIndicator {...props} color="#2BB8CB" value={lastPoints.espera} unit="m" />
                                                )}
                                            />
                                        )}
                                        {lastPoints.servicio !== null && visibleLines.servicio && (
                                            <ReferenceLine
                                                yAxisId="left"
                                                y={lastPoints.servicio}
                                                stroke="#3b82f6"
                                                strokeDasharray="3 3"
                                                strokeWidth={1}
                                                label={(props: any) => (
                                                    <FinanceIndicator {...props} color="#3b82f6" value={lastPoints.servicio} unit="m" />
                                                )}
                                            />
                                        )}
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                            {/* ── Interval Selector ── */}
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px 16px 6px',
                                borderTop: '1px solid rgba(0,0,0,0.06)'
                            }}>
                                <span style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    color: '#6b7280',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.06em',
                                    marginRight: '4px'
                                }}>Intervalo</span>
                                {([
                                    { label: 'Minuto', value: 'minute' },
                                    { label: '30 min', value: '30min' },
                                    { label: 'Por hora', value: 'hour' },
                                ] as { label: string; value: ZoomLevel }[]).map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => {
                                            setZoomLevel(opt.value);
                                            setZoomRange({ start: 0, end: 100 });
                                            fetchLiveData(opt.value === 'hour' ? 'hour' : 'minute');
                                        }}
                                        style={{
                                            padding: '3px 14px',
                                            borderRadius: '999px',
                                            border: zoomLevel === opt.value ? '1.5px solid #3b82f6' : '1.5px solid #e5e7eb',
                                            backgroundColor: zoomLevel === opt.value ? '#3b82f6' : 'transparent',
                                            color: zoomLevel === opt.value ? '#fff' : '#374151',
                                            fontSize: '12px',
                                            fontWeight: zoomLevel === opt.value ? 600 : 400,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                            outline: 'none',
                                        }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Área Derecha: Rankings Sidebar (4 de 12 o 3 de 12 columnas) */}
                    <div className="lg:col-span-4 2xl:col-span-3 h-full min-h-[400px]">
                        <div className="h-full">
                            <RankingsPanel />
                        </div>
                    </div>
                </div>
            </div>

            {/* Waiting By Unit Modal */}
            {showWaitingModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setShowWaitingModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div>
                                <h3 className="text-base font-black text-slate-800">En Espera por Unidad</h3>
                                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Ordenado de mayor a menor · Tiempo real</p>
                            </div>
                            <button
                                onClick={() => setShowWaitingModal(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
                            >✕</button>
                        </div>
                        {/* Table */}
                        <div className="overflow-auto max-h-[60vh]">
                            {(!globals?.WaitingByUnit || globals.WaitingByUnit.length === 0) ? (
                                <div className="text-center text-slate-400 py-10 text-sm">No hay unidades con personas en espera</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">#</th>
                                            <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Unidad</th>
                                            <th className="text-right px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">En Espera</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(globals.WaitingByUnit as any[]).map((row: any, i: number) => (
                                            <tr
                                                key={i}
                                                className={`border-b border-slate-50 hover:bg-blue-50 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                                                onClick={() => openWaitingDrill(row.UnitName)}
                                                title={`Ver turnos en espera de ${row.UnitName}`}
                                            >
                                                <td className="px-5 py-2.5 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                <td className="px-5 py-2.5 text-sm font-semibold text-slate-700">{row.UnitName}</td>
                                                <td className="px-5 py-2.5 text-right">
                                                    <span className={`inline-flex items-center justify-center min-w-[36px] px-2 py-0.5 rounded-full text-sm font-black ${row.CurrentlyWaiting >= 20 ? 'bg-red-100 text-red-700' :
                                                        row.CurrentlyWaiting >= 10 ? 'bg-amber-100 text-amber-700' :
                                                            'bg-green-100 text-green-700'
                                                        }`}>
                                                        {Number(row.CurrentlyWaiting).toLocaleString('es-CO')}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-50 border-t border-slate-200">
                                            <td colSpan={2} className="px-5 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">Total</td>
                                            <td className="px-5 py-2.5 text-right">
                                                <span className="text-sm font-black text-slate-800">
                                                    {(globals?.CurrentlyWaiting || 0).toLocaleString('es-CO')}
                                                </span>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Waiting Tickets Drill-down Modal */}
            {waitingDrillUnit && (() => {
                return (
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
                        style={{ backgroundColor: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(4px)' }}
                        onClick={() => { setWaitingDrillUnit(null); setWaitingDrillView('detail'); }}
                    >
                        <div
                            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex flex-col border-b border-slate-100">
                                <div className="flex items-center justify-between px-5 py-4">
                                    <div>
                                        <h3 className="text-base font-black text-slate-800">🎟️ Turnos en Espera · {waitingDrillUnit}</h3>
                                        <p className="text-[11px] text-slate-400 font-medium mt-0.5">Ordenados por tiempo de llegada · Tiempo real</p>
                                    </div>
                                    <button
                                        onClick={() => { setWaitingDrillUnit(null); setWaitingDrillView('detail'); }}
                                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
                                    >✕</button>
                                </div>

                                {/* View Toggle */}
                                <div className="px-5 pb-3">
                                    <div className="flex inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                                        <button
                                            onClick={() => setWaitingDrillView('detail')}
                                            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${waitingDrillView === 'detail' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            📝 Detalle (Tickets)
                                        </button>
                                        <button
                                            onClick={() => setWaitingDrillView('summary')}
                                            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${waitingDrillView === 'summary' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            📊 Resumen (Por Servicio)
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Body */}
                            <div className="overflow-auto max-h-[65vh]">
                                {waitingDrillLoading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mr-3"></div>
                                        <span className="text-sm text-slate-500 font-medium">Cargando turnos...</span>
                                    </div>
                                ) : waitingDrillData.length === 0 ? (
                                    <div className="text-center text-slate-400 py-10 text-sm">No se encontraron turnos en espera para esta unidad</div>
                                ) : waitingDrillView === 'summary' ? (
                                    <table className="w-full">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-100">
                                                <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider w-12">#</th>
                                                <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Servicio</th>
                                                <th className="text-right px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">En Espera</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {groupedData.map((row: any, i: number) => (
                                                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                                    <td className="px-5 py-3 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                    <td className="px-5 py-3 text-sm font-semibold text-slate-700">{row.service}</td>
                                                    <td className="px-5 py-3 text-right">
                                                        <span className={`inline-flex items-center justify-center min-w-[36px] px-2 py-0.5 rounded-full text-sm font-black ${row.count >= 20 ? 'bg-red-100 text-red-700' :
                                                            row.count >= 10 ? 'bg-amber-100 text-amber-700' :
                                                                'bg-blue-100 text-blue-700'
                                                            }`}>
                                                            {Number(row.count).toLocaleString('es-CO')}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-slate-50 border-t border-slate-200">
                                                <td colSpan={2} className="px-5 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">
                                                    Total general
                                                </td>
                                                <td className="px-5 py-2.5 text-right flex justify-end">
                                                    <span className="text-sm font-black text-slate-800 flex justify-end">
                                                        {waitingDrillData.length.toLocaleString('es-CO')}
                                                    </span>
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                ) : (
                                    <table className="w-full">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-100">
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">#</th>
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">N° Turno</th>
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Servicio</th>
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Entrada</th>
                                                <th className="text-right px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">En Espera</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {waitingDrillData.map((ticket: any, i: number) => {
                                                const fetchedSecs = Number(ticket.SecondsWaiting || 0);
                                                const warningSecs = Number(ticket.WaitingTimeWarning || 600);
                                                const criticalSecs = Number(ticket.WaitingTimeCritical || 1200);

                                                const entryTime = ticket.StartDate
                                                    ? new Date(ticket.StartDate).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                                                    : '—';
                                                return (
                                                    <tr key={i} className={`border-b border-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                                        <td className="px-4 py-2 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                        <td className="px-4 py-2 text-sm font-black text-blue-700">{ticket.ProcessId}</td>
                                                        <td className="px-4 py-2 text-xs text-slate-600 max-w-[160px] truncate" title={ticket.ServiceName}>{ticket.ServiceName || '—'}</td>
                                                        <td className="px-4 py-2 text-xs text-slate-500">{entryTime}</td>
                                                        <td className="px-4 py-2 text-right font-mono text-sm tracking-tight text-right w-[100px]">
                                                            <div className="flex justify-end pr-2">
                                                                <LiveTimerBadge
                                                                    fetchedSecs={fetchedSecs}
                                                                    warningSecs={warningSecs}
                                                                    criticalSecs={criticalSecs}
                                                                />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-slate-50 border-t border-slate-200">
                                                <td colSpan={5} className="px-4 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">
                                                    Total: {waitingDrillData.length} turnos en espera
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Service Tickets Drill-down Modal */}
            {serviceDrillUnit && (() => {
                return (
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
                        style={{ backgroundColor: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(4px)' }}
                        onClick={() => { setServiceDrillUnit(null); setServiceDrillView('detail'); }}
                    >
                        <div
                            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex flex-col border-b border-slate-100">
                                <div className="flex items-center justify-between px-5 py-4">
                                    <div>
                                        <h3 className="text-base font-black text-slate-800">🗣️ Turnos en Atención · {serviceDrillUnit}</h3>
                                        <p className="text-[11px] text-slate-400 font-medium mt-0.5">Ordenados por hora de inicio de atención · Tiempo real</p>
                                    </div>
                                    <button
                                        onClick={() => { setServiceDrillUnit(null); setServiceDrillView('detail'); }}
                                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
                                    >✕</button>
                                </div>

                                {/* View Toggle */}
                                <div className="px-5 pb-3">
                                    <div className="flex inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                                        <button
                                            onClick={() => setServiceDrillView('detail')}
                                            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${serviceDrillView === 'detail' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            📝 Detalle (Tickets)
                                        </button>
                                        <button
                                            onClick={() => setServiceDrillView('summary')}
                                            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${serviceDrillView === 'summary' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            📊 Resumen (Por Servicio)
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Body */}
                            <div className="overflow-auto max-h-[65vh]">
                                {serviceDrillLoading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mr-3"></div>
                                        <span className="text-sm text-slate-500 font-medium">Cargando turnos...</span>
                                    </div>
                                ) : serviceDrillData.length === 0 ? (
                                    <div className="text-center text-slate-400 py-10 text-sm">No se encontraron turnos en atención para esta unidad</div>
                                ) : serviceDrillView === 'summary' ? (
                                    <table className="w-full">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-100">
                                                <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider w-12">#</th>
                                                <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Servicio</th>
                                                <th className="text-right px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">En Atención</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {groupedServiceData.map((row: any, i: number) => (
                                                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                                    <td className="px-5 py-3 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                    <td className="px-5 py-3 text-sm font-semibold text-slate-700">{row.service}</td>
                                                    <td className="px-5 py-3 text-right">
                                                        <span className={`inline-flex items-center justify-center min-w-[36px] px-2 py-0.5 rounded-full text-sm font-black ${row.count >= 20 ? 'bg-red-100 text-red-700' :
                                                            row.count >= 10 ? 'bg-amber-100 text-amber-700' :
                                                                'bg-blue-100 text-blue-700'
                                                            }`}>
                                                            {Number(row.count).toLocaleString('es-CO')}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-slate-50 border-t border-slate-200">
                                                <td colSpan={2} className="px-5 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">
                                                    Total general
                                                </td>
                                                <td className="px-5 py-2.5 text-right flex justify-end">
                                                    <span className="text-sm font-black text-slate-800 flex justify-end">
                                                        {serviceDrillData.length.toLocaleString('es-CO')}
                                                    </span>
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                ) : (
                                    <table className="w-full">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-100">
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">#</th>
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">N° Turno</th>
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Servicio</th>
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Inicio Atenc.</th>
                                                <th className="text-right px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Atendiendo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {serviceDrillData.map((ticket: any, i: number) => {
                                                const fetchedSecs = Number(ticket.SecondsServing || 0);
                                                const warningSecs = Number(ticket.ServiceTimeWarning || 600);
                                                const criticalSecs = Number(ticket.ServiceTimeCritical || 1200);

                                                const entryTime = ticket.StartDate
                                                    ? new Date(ticket.StartDate).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                                                    : '—';
                                                return (
                                                    <tr key={i} className={`border-b border-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                                        <td className="px-4 py-2 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                        <td className="px-4 py-2 text-sm font-black text-blue-700">{ticket.ProcessId}</td>
                                                        <td className="px-4 py-2 text-xs text-slate-600 max-w-[160px] truncate" title={ticket.ServiceName}>{ticket.ServiceName || '—'}</td>
                                                        <td className="px-4 py-2 text-xs text-slate-500">{entryTime}</td>
                                                        <td className="px-4 py-2 text-right font-mono text-sm tracking-tight text-right w-[100px]">
                                                            <div className="flex justify-end pr-2">
                                                                <LiveTimerBadge
                                                                    fetchedSecs={fetchedSecs}
                                                                    warningSecs={warningSecs}
                                                                    criticalSecs={criticalSecs}
                                                                />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-slate-50 border-t border-slate-200">
                                                <td colSpan={5} className="px-4 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">
                                                    Total: {serviceDrillData.length} turnos en atención
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Max Wait By Unit Modal */}
            {showMaxWaitModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setShowMaxWaitModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div>
                                <h3 className="text-base font-black text-slate-800">Máximo Tiempo de Espera</h3>
                                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Ordenado de mayor a menor · Tiempo real</p>
                            </div>
                            <button
                                onClick={() => setShowMaxWaitModal(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
                            >✕</button>
                        </div>
                        {/* Table */}
                        <div className="overflow-auto max-h-[60vh]">
                            {(!globals?.WaitingByUnit || globals.WaitingByUnit.length === 0) ? (
                                <div className="text-center text-slate-400 py-10 text-sm">No hay unidades con personas en espera</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">#</th>
                                            <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Unidad</th>
                                            <th className="text-right px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Tiempo Máx</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...(globals.WaitingByUnit as any[])]
                                            .sort((a, b) => {
                                                const timeA = a.MaxWaitingTime || '00:00:00';
                                                const timeB = b.MaxWaitingTime || '00:00:00';
                                                return timeB.localeCompare(timeA);
                                            })
                                            .map((row: any, i: number) => {
                                                const time = row.MaxWaitingTime || '00:00:00';
                                                const formattedTime = time.split(':').length === 3 && time.indexOf(':') === 1 ? `0${time}` : time;
                                                return (
                                                    <tr
                                                        key={i}
                                                        className={`border-b border-slate-50 hover:bg-amber-50 cursor-pointer transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                                                        onClick={() => {
                                                            setShowMaxWaitModal(false);
                                                            openWaitingDrill(row.UnitName);
                                                        }}
                                                        title={`Ver turnos en espera de ${row.UnitName}`}
                                                    >
                                                        <td className="px-5 py-2.5 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                        <td className="px-5 py-2.5 text-sm font-semibold text-slate-700">{row.UnitName}</td>
                                                        <td className="px-5 py-2.5 text-right flex justify-end">
                                                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-sm font-black tracking-wider">
                                                                {formattedTime}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-50 border-t border-slate-200">
                                            <td colSpan={2} className="px-5 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">MAX</td>
                                            <td className="px-5 py-2.5 text-right flex justify-end">
                                                <span className="text-sm font-black text-slate-800 flex justify-end">
                                                    {(() => {
                                                        const time = globals?.MaxWaitingTime || '00:00:00';
                                                        return time.split(':').length === 3 && time.indexOf(':') === 1 ? `0${time}` : time;
                                                    })()}
                                                </span>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Max Service By Unit Modal */}
            {showMaxServiceModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setShowMaxServiceModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div>
                                <h3 className="text-base font-black text-slate-800">Máximo Tiempo de Atención</h3>
                                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Ordenado de mayor a menor · Tiempo real</p>
                            </div>
                            <button
                                onClick={() => setShowMaxServiceModal(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
                            >✕</button>
                        </div>
                        {/* Table */}
                        <div className="overflow-auto max-h-[60vh]">
                            {(!globals?.WaitingByUnit || globals.WaitingByUnit.length === 0) ? (
                                <div className="text-center text-slate-400 py-10 text-sm">No hay unidades para mostrar</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">#</th>
                                            <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Unidad</th>
                                            <th className="text-right px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Tiempo Máx</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...(globals.WaitingByUnit as any[])]
                                            .sort((a, b) => {
                                                const timeA = a.MaxServiceTime || '00:00:00';
                                                const timeB = b.MaxServiceTime || '00:00:00';
                                                return timeB.localeCompare(timeA);
                                            })
                                            .map((row: any, i: number) => {
                                                const time = row.MaxServiceTime || '00:00:00';
                                                const formattedTime = time.split(':').length === 3 && time.indexOf(':') === 1 ? `0${time}` : time;
                                                return (
                                                    <tr
                                                        key={i}
                                                        className={`border-b border-slate-50 hover:bg-indigo-50 cursor-pointer transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                                                        onClick={() => {
                                                            setShowMaxServiceModal(false);
                                                            openServiceDrill(row.UnitName);
                                                        }}
                                                        title={`Ver turnos en atención de ${row.UnitName}`}
                                                    >
                                                        <td className="px-5 py-2.5 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                        <td className="px-5 py-2.5 text-sm font-semibold text-slate-700">{row.UnitName}</td>
                                                        <td className="px-5 py-2.5 text-right flex justify-end">
                                                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-sm font-black tracking-wider">
                                                                {formattedTime}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-50 border-t border-slate-200">
                                            <td colSpan={2} className="px-5 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">MAX</td>
                                            <td className="px-5 py-2.5 text-right flex justify-end">
                                                <span className="text-sm font-black text-slate-800 flex justify-end">
                                                    {(() => {
                                                        const time = globals?.MaxServiceTime || '00:00:00';
                                                        return time.split(':').length === 3 && time.indexOf(':') === 1 ? `0${time}` : time;
                                                    })()}
                                                </span>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* % Objetivo By Unit Modal */}
            {showObjetivoModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setShowObjetivoModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div>
                                <h3 className="text-base font-black text-slate-800">% Objetivo por Unidad</h3>
                                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Ordenado de mayor a menor</p>
                            </div>
                            <button
                                onClick={() => setShowObjetivoModal(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
                            >✕</button>
                        </div>
                        {/* Table */}
                        <div className="overflow-auto max-h-[60vh]">
                            {(!globals?.Top_Unidades_Volumen || globals.Top_Unidades_Volumen.length === 0) ? (
                                <div className="text-center text-slate-400 py-10 text-sm">No hay unidades para mostrar</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">#</th>
                                            <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Unidad</th>
                                            <th className="text-right px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">% Objetivo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...(globals.Top_Unidades_Volumen as any[])]
                                            .sort((a, b) => {
                                                const pctA = Number(a.PorcentajeEnObjetivo || 0);
                                                const pctB = Number(b.PorcentajeEnObjetivo || 0);
                                                return pctB - pctA;
                                            })
                                            .map((row: any, i: number) => {
                                                const pct = Number(row.PorcentajeEnObjetivo || 0);
                                                let badgeClass = 'bg-[#8eb355] text-white'; // >= 80
                                                if (pct < 50) badgeClass = 'bg-[#F15B4E] text-white';
                                                else if (pct < 80) badgeClass = 'bg-[#F1DB51] text-slate-900';

                                                return (
                                                    <tr
                                                        key={i}
                                                        className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                                                    >
                                                        <td className="px-5 py-2.5 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                        <td className="px-5 py-2.5 text-sm font-semibold text-slate-700">{row.Oficina}</td>
                                                        <td className="px-5 py-2.5 text-right flex justify-end">
                                                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded shadow-sm text-sm font-black tracking-wider ${badgeClass}`}>
                                                                {pct}%
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-50 border-t border-slate-200">
                                            <td colSpan={2} className="px-5 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">PROMEDIO GLOBAL</td>
                                            <td className="px-5 py-2.5 text-right flex justify-end">
                                                <span className="text-sm font-black text-[#8eb355] flex justify-end pr-2">
                                                    {(() => {
                                                        const val = selectedService ? (globals?.Servicio_PorcentajeEsperaEnObjetivo) :
                                                            selectedSede ? (globals?.Oficina_PorcentajeEsperaEnObjetivo) :
                                                                (globals?.Global_PorcentajeEsperaEnObjetivo);
                                                        return val !== undefined ? `${Math.round(val)}%` : '--%';
                                                    })()}
                                                </span>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Generic Agent Stats Modal */}
            {agentModalType && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setAgentModalType(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {(() => {
                            const config = {
                                AgentsSignedIn: { title: 'Agentes Logueados', color: 'bg-blue-100 text-[#00A1DF]', label: 'Conectados', globalKey: 'AgentsSignedIn' },
                                AgentsInService: { title: 'Agentes en Atención', color: 'bg-green-100 text-[#5a801e]', label: 'Atendiendo', globalKey: 'AgentsInService' },
                                AgentsIdle: { title: 'Agentes Inactivos', color: 'bg-green-100 text-[#5a801e]', label: 'Inactivos', globalKey: 'AgentsIdle' },
                                AgentsInBackOffice: { title: 'Agentes en Backoffice', color: 'bg-orange-100 text-orange-600', label: 'Backoffice', globalKey: 'AgentsInBackOffice' },
                                AgentsInReception: { title: 'Agentes en Recepción', color: 'bg-purple-100 text-purple-600', label: 'Recepción', globalKey: 'AgentsInReception' }
                            }[agentModalType];

                            return (
                                <>
                                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                                        <div>
                                            <h3 className="text-base font-black text-slate-800">{config.title}</h3>
                                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">Ordenado de mayor a menor · Tiempo real</p>
                                        </div>
                                        <button
                                            onClick={() => setAgentModalType(null)}
                                            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
                                        >✕</button>
                                    </div>
                                    <div className="overflow-auto max-h-[60vh]">
                                        {(!globals?.WaitingByUnit || globals.WaitingByUnit.length === 0 || globals.WaitingByUnit.filter((r: any) => Number(r[config.globalKey] || 0) > 0).length === 0) ? (
                                            <div className="text-center text-slate-400 py-10 text-sm">No hay unidades para mostrar</div>
                                        ) : (
                                            <table className="w-full">
                                                <thead>
                                                    <tr className="bg-slate-50 border-b border-slate-100">
                                                        <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">#</th>
                                                        <th className="text-left px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Unidad</th>
                                                        <th className="text-right px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">{config.label}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {[...(globals.WaitingByUnit as any[])]
                                                        .filter(row => Number(row[config.globalKey] || 0) > 0)
                                                        .sort((a, b) => Number(b[config.globalKey] || 0) - Number(a[config.globalKey] || 0))
                                                        .map((row: any, i: number) => (
                                                            <tr
                                                                key={i}
                                                                className={`border-b border-slate-50 hover:bg-blue-50 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                                                                onClick={() => openAgentDrill(row.UnitName, agentModalType!)}
                                                                title={`Ver agentes de ${row.UnitName}`}
                                                            >
                                                                <td className="px-5 py-2.5 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                                <td className="px-5 py-2.5 text-sm font-semibold text-slate-700">{row.UnitName}</td>
                                                                <td className="px-5 py-2.5 text-right flex justify-end">
                                                                    <span className={`inline-flex items-center justify-center min-w-[36px] px-2 py-0.5 rounded-full text-sm font-black ${config.color}`}>
                                                                        {Number(row[config.globalKey] || 0).toLocaleString('es-CO')}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                </tbody>
                                                <tfoot>
                                                    <tr className="bg-slate-50 border-t border-slate-200">
                                                        <td colSpan={2} className="px-5 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">Global</td>
                                                        <td className="px-5 py-2.5 text-right flex justify-end">
                                                            <span className="text-sm font-black text-slate-800 flex justify-end">
                                                                {Number(globals?.[config.globalKey] || 0).toLocaleString('es-CO')}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Agent Drill-down Detail Modal */}
            {agentDrillUnit && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4"
                    style={{ backgroundColor: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setAgentDrillUnit(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div>
                                <h3 className="text-base font-black text-slate-800">🧑‍💼 {agentDrillUnit}</h3>
                                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Detalle de agentes · Tiempo real</p>
                            </div>
                            <button
                                onClick={() => setAgentDrillUnit(null)}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
                            >✕</button>
                        </div>
                        {/* Body */}
                        <div className="overflow-auto max-h-[65vh]">
                            {agentDrillLoading ? (
                                <div className="flex items-center justify-center py-12">
                                    <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mr-3"></div>
                                    <span className="text-sm text-slate-500 font-medium">Cargando agentes...</span>
                                </div>
                            ) : agentDrillData.length === 0 ? (
                                <div className="text-center text-slate-400 py-10 text-sm">No se encontraron agentes para esta unidad</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="text-left px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">#</th>
                                            {(['FullName', 'FunctionName', 'AgentState'] as const).map(col => {
                                                const labels = { FullName: 'Nombre', FunctionName: 'Función', AgentState: 'Estado' };
                                                const isActive = agentDrillSort === col;
                                                return (
                                                    <th
                                                        key={col}
                                                        className={`text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-wider cursor-pointer select-none transition-colors ${isActive ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
                                                            } ${col === 'AgentState' ? 'text-right' : ''}`}
                                                        onClick={() => handleDrillSort(col)}
                                                    >
                                                        {labels[col]} {isActive ? (agentDrillDir === 'asc' ? '↑' : '↓') : '↕'}
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...agentDrillData]
                                            .sort((a, b) => {
                                                const va = (a[agentDrillSort] || '').toString().toLowerCase();
                                                const vb = (b[agentDrillSort] || '').toString().toLowerCase();
                                                return agentDrillDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
                                            })
                                            .map((agent: any, i: number) => {
                                                const state: string = agent.AgentState || 'Unknown';
                                                const stateColor = state === 'InService' ? 'bg-green-100 text-green-700'
                                                    : state === 'Idle' ? 'bg-amber-100 text-amber-700'
                                                        : state === 'BackOffice' ? 'bg-orange-100 text-orange-700'
                                                            : state === 'Reception' ? 'bg-purple-100 text-purple-700'
                                                                : 'bg-slate-100 text-slate-500';
                                                const stateLabel: Record<string, string> = {
                                                    InService: 'En Atención',
                                                    Idle: 'Inactivo',
                                                    BackOffice: 'Backoffice',
                                                    Reception: 'Recepción',
                                                };
                                                return (
                                                    <tr key={i} className={`border-b border-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                                        <td className="px-4 py-2 text-xs font-bold text-slate-400">#{i + 1}</td>
                                                        <td className="px-4 py-2 text-sm font-semibold text-slate-700 max-w-[160px] truncate" title={agent.FullName}>{agent.FullName || '—'}</td>
                                                        <td className="px-4 py-2 text-xs text-slate-500">{agent.FunctionName || '—'}</td>
                                                        <td className="px-4 py-2 text-right">
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${stateColor}`}>
                                                                {stateLabel[state] || state}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-50 border-t border-slate-200">
                                            <td colSpan={4} className="px-4 py-2.5 text-xs font-black text-slate-500 uppercase tracking-wider">
                                                Total: {agentDrillData.length} agentes
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* AI Copilot Chat UI */}
            <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
                {/* Chat Popover */}
                {isChatOpen && (
                    <div className="bg-white rounded-2xl shadow-2xl overflow-hidden mb-4 border border-slate-100 flex flex-col" style={{ width: '380px', height: '550px', maxHeight: 'calc(100vh - 120px)' }}>
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0 bg-gradient-to-r from-purple-50 to-white">
                            <div className="flex items-center gap-2">
                                <span className="text-xl">✨</span>
                                <div>
                                    <h3 className="text-sm font-black text-purple-900 bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-indigo-600">Asistente de Datos en Vivo</h3>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setChatMessages([])}
                                    title="Volver al inicio"
                                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                        <polyline points="9 22 9 12 15 12 15 22" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => setIsChatOpen(false)}
                                    title="Cerrar chat"
                                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors ml-1"
                                >✕</button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
                            {chatMessages.length === 0 ? (
                                <div className="h-full flex flex-col justify-center">
                                    <h2 className="text-2xl font-black text-slate-800 mb-1">Hola, <br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600">¿En qué te ayudo?</span></h2>
                                    <p className="text-xs text-slate-500 mb-6">Prueba estas preguntas basándome en los datos actuales:</p>

                                    {/* Suggested Prompts */}
                                    <div className="flex flex-col gap-2">
                                        {[
                                            "⏳ ¿Cuáles son las 3 sedes con mayor tiempo de espera?",
                                            "👨‍💻 ¿Cuántos agentes están inactivos ahora mismo?",
                                            "📊 Resume el volumen general de hoy."
                                        ].map((prompt, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => handleSendChatMessage(prompt.replace(/^[^\s]+\s/, ''))} // Remove emoji for sending
                                                className="text-left bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:border-purple-300 hover:shadow-md transition-all group"
                                            >
                                                <p className="text-xs font-semibold text-slate-700 group-hover:text-purple-700">{prompt}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {chatMessages.map((msg, idx) => (
                                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'user'
                                                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-tr-sm shadow-md'
                                                : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm shadow-sm'
                                                }`}>
                                                {/* Simple formatting for model text (bolds and breaks) */}
                                                {msg.role === 'model' ? (
                                                    <div dangerouslySetInnerHTML={{
                                                        __html: msg.content
                                                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                                            .replace(/\n/g, '<br/>')
                                                    }} />
                                                ) : (
                                                    <p>{msg.content}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {isChatLoading && (
                                        <div className="flex justify-start">
                                            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex gap-1">
                                                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce"></div>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>
                            )}
                        </div>

                        {/* Input Area */}
                        <div className="p-4 bg-white border-t border-slate-100 shrink-0">
                            <form
                                onSubmit={(e) => { e.preventDefault(); handleSendChatMessage(); }}
                                className="relative flex items-end gap-2"
                            >
                                <textarea
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendChatMessage();
                                        }
                                    }}
                                    placeholder="Pregunta algo sobre los datos en vivo..."
                                    className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-xl py-3 pl-4 pr-12 outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 resize-none transition-all shadow-inner"
                                    rows={1}
                                    style={{ minHeight: '44px', maxHeight: '120px' }}
                                />
                                <button
                                    type="submit"
                                    disabled={!chatInput.trim() || isChatLoading}
                                    className="absolute right-2 bottom-2 w-8 h-8 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white rounded-lg flex flex-col items-center justify-center transition-colors shadow-md"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="22" y1="2" x2="11" y2="13"></line>
                                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                    </svg>
                                </button>
                            </form>
                            <p className="text-center text-[9px] text-slate-400 font-medium mt-2">La IA puede cometer errores. Verifica la info.</p>
                        </div>
                    </div>
                )}

                {/* FAB Button */}
                <button
                    onClick={() => setIsChatOpen(!isChatOpen)}
                    className={`w-14 h-14 rounded-full flex flex-col items-center justify-center text-white shadow-xl hover:scale-105 active:scale-95 transition-all text-2xl group relative overflow-hidden bg-gradient-to-r from-purple-600 to-indigo-600`}
                >
                    {!isChatOpen && (
                        <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
                    )}
                    <span className="relative z-10 text-yellow-400 drop-shadow-sm">
                        {isChatOpen ? (
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m6 9 6 6 6-6"/>
                            </svg>
                        ) : (
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 3l1.8 5.6 5.6 1.8-5.6 1.8L12 18l-1.8-5.6-5.6-1.8 5.6-1.8L12 3z"/>
                                <path d="M18 14l1.2 3.8 3.8 1.2-3.8 1.2L18 24l-1.2-3.8-3.8-1.2 3.8-1.2L18 14z" opacity="0.6"/>
                                <path d="M5 14l0.8 2.6 2.6 0.8-2.6 0.8L5 21l-0.8-2.6-2.6-0.8 2.6-0.8L5 14z" opacity="0.8"/>
                            </svg>
                        )}
                    </span>
                </button>
            </div>
        </>
    );
};

export default LiveData;
