import express from 'express';
import { BigQuery } from '@google-cloud/bigquery';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env.local') });

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Servir archivos estáticos de la carpeta 'dist' (generada por npm run build)
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });


const bigquery = new BigQuery({
  keyFilename: 'bigquery_credentials.json',
  projectId: 'master-reactor-476520-p0',
});

app.get('/api/query/auto', async (req, res) => {
  const { date } = req.query;

  // Filtro de fecha: si se proporciona fecha específica, sino últimos 7 días
  const dateClause = date
    ? `DATE(Fecha_Hora_Proceso) = '${date}'`
    : "DATE(Fecha_Hora_Proceso) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)";

  const query = `
    WITH BaseData AS (
      SELECT
        COALESCE(Oficina, 'Pendientes') AS Oficina,
        UnitId,
        COALESCE(Servicio, 'Pendientes') AS Servicio,
        ServiceId,
        DATE(Fecha_Hora_Proceso) AS fecha_d,
        EXTRACT(HOUR FROM Fecha_Hora_Proceso) AS hora_h,
        ProcessId,
        ID_Estado,
        Duracion_Segundos,
        UserId,
        WaitingTimeWarning,
        WaitingTimeCritical,
        ServiceTimeWarning,
        ServiceTimeCritical
      FROM \`master-reactor-476520-p0.Dislive.UnitsLiveDetailed\`
      WHERE ${dateClause}
    ),
    AggregatedData AS (
      SELECT
        Oficina,
        UnitId,
        Servicio,
        ServiceId,
        fecha_d,
        hora_h,
        -- Total de turnos: atendidos (6) + abandonados (4)
        COUNTIF(ID_Estado = 6) + COUNTIF(ID_Estado = 4) AS totalTurnos,
        -- Atendidos: ID_Estado = 6 (InService)
        COUNTIF(ID_Estado = 6) AS atendidos,
        -- Abandonados: ID_Estado = 4 (Abandoned)
        COUNTIF(ID_Estado = 4) AS abandonados,
        -- Tiempo promedio de espera: promedio de duración para estados 3 y 11 (Waiting)
        AVG(CASE WHEN ID_Estado IN (3, 11) THEN Duracion_Segundos END) AS avgWaitingTime,
        -- Tiempo promedio de servicio: promedio de duración para estado 6 (InService)
        AVG(CASE WHEN ID_Estado = 6 THEN Duracion_Segundos END) AS avgServiceTime,
        -- Agentes únicos que atendieron
        COUNT(DISTINCT CASE WHEN ID_Estado = 6 THEN UserId END) AS agentes,
        -- Tiempo total de servicio en segundos
        SUM(CASE WHEN ID_Estado = 6 THEN Duracion_Segundos ELSE 0 END) AS totalServiceTimeSeconds,
        -- Turnos atendidos reales (procesos únicos atendidos)
        COUNT(DISTINCT CASE WHEN ID_Estado = 6 THEN ProcessId END) AS turnosAtendidosReales,
        -- Umbrales (tomamos el primer valor no nulo)
        MAX(WaitingTimeWarning) AS waitingTimeWarning,
        MAX(WaitingTimeCritical) AS waitingTimeCritical,
        MAX(ServiceTimeWarning) AS serviceTimeWarning,
        MAX(ServiceTimeCritical) AS serviceTimeCritical
      FROM BaseData
      GROUP BY Oficina, UnitId, Servicio, ServiceId, fecha_d, hora_h
    )
    SELECT
      Oficina AS sede,
      Servicio AS servicio,
      FORMAT_DATE('%Y-%m-%d', fecha_d) AS fecha,
      FORMAT('%02d:00:00', hora_h) AS hora,
      -- Formatear tiempo de servicio como HH:MM:SS
      FORMAT('%02d:%02d:%02d', 
        CAST(FLOOR(COALESCE(avgServiceTime, 0) / 3600) AS INT64), 
        CAST(FLOOR(MOD(CAST(COALESCE(avgServiceTime, 0) AS INT64), 3600) / 60) AS INT64), 
        CAST(MOD(CAST(COALESCE(avgServiceTime, 0) AS INT64), 60) AS INT64)
      ) AS tiempoServicio,
      -- Formatear tiempo de espera como HH:MM:SS
      FORMAT('%02d:%02d:%02d', 
        CAST(FLOOR(COALESCE(avgWaitingTime, 0) / 3600) AS INT64), 
        CAST(FLOOR(MOD(CAST(COALESCE(avgWaitingTime, 0) AS INT64), 3600) / 60) AS INT64), 
        CAST(MOD(CAST(COALESCE(avgWaitingTime, 0) AS INT64), 60) AS INT64)
      ) AS tiempoEspera,
      totalTurnos,
      atendidos,
      abandonados,
      SAFE_DIVIDE(abandonados, totalTurnos) AS tasaAbandono,
      -- Formatear tiempo total de servicio como HH:MM:SS
      FORMAT('%02d:%02d:%02d', 
        CAST(FLOOR(COALESCE(totalServiceTimeSeconds, 0) / 3600) AS INT64), 
        CAST(FLOOR(MOD(CAST(COALESCE(totalServiceTimeSeconds, 0) AS INT64), 3600) / 60) AS INT64), 
        CAST(MOD(CAST(COALESCE(totalServiceTimeSeconds, 0) AS INT64), 60) AS INT64)
      ) AS tiempoTotalServicio,
      CAST(agentes AS INT64) AS agentes,
      CAST(turnosAtendidosReales AS INT64) AS turnosAtendidosReales,
      -- Estos campos no están disponibles en UnitsLiveDetailed, se ponen en 0
      0 AS atendidosMismaHora,
      0 AS noAtendidosMismaHora,
      COALESCE(waitingTimeWarning, 0) AS waitingTimeWarning,
      COALESCE(waitingTimeCritical, 0) AS waitingTimeCritical,
      COALESCE(serviceTimeWarning, 0) AS serviceTimeWarning,
      COALESCE(serviceTimeCritical, 0) AS serviceTimeCritical
    FROM AggregatedData
    ORDER BY fecha DESC, hora ASC
  `;

  try {
    const [rows] = await bigquery.query({ query });
    res.json(rows);
  } catch (error) {
    console.error('Error in auto query:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/query/services', async (req, res) => {
  const { date, hour, unitName } = req.query;
  const hourInt = parseInt(hour.substring(0, 2), 10);
  const startTime = `${date} ${hour.substring(0, 2)}:00:00`;
  const endTime = `${date} ${hour.substring(0, 2)}: 59: 59`;

  const query = `
    WITH TurnsData AS(
    SELECT
        ServiceId,
    ServiceName as servicio,
    DATE(StartDate) as fecha_d,
    EXTRACT(HOUR FROM StartDate) as hora_h,
    SUM(Served) as atendidos,
    SUM(Abandoned) as abandonados,
    AVG(AvgServiceTime) as avgServiceTime,
    AVG(AvgWaitingTime) as avgWaitingTime
      FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\`
      WHERE DATE(StartDate) = '${date}' AND EXTRACT(HOUR FROM StartDate) = ${hourInt} AND UnitName = '${unitName}'
      GROUP BY 1, 2, 3, 4
    ),
    AgentsData AS (
      SELECT 
        ServiceId,
        COUNT(DISTINCT UserId) as agentes,
        SUM(CASE WHEN TIMESTAMP_ADD(StartDate, INTERVAL Duration SECOND) <= TIMESTAMP('${endTime}') THEN Duration ELSE TIMESTAMP_DIFF(TIMESTAMP('${endTime}'), StartDate, SECOND) END) as totalServiceTimeSeconds,
        COUNT(DISTINCT ProcessId) as turnosAtendidosReales
      FROM \`master-reactor-476520-p0.Dislive.AgentServiceTime\`
      WHERE StartDate BETWEEN TIMESTAMP('${startTime}') AND TIMESTAMP('${endTime}')
      GROUP BY 1
    )
    SELECT
      t.servicio,
      FORMAT_DATE('%Y-%m-%d', t.fecha_d) as fecha,
      FORMAT('%02d:00:00', t.hora_h) as hora,
      (COALESCE(t.atendidos, 0) + COALESCE(t.abandonados, 0)) as totalTurnos,
      COALESCE(t.atendidos, 0) as atendidos,
      COALESCE(t.abandonados, 0) as abandonados,
      FORMAT('%02d:%02d:%02d', CAST(FLOOR(COALESCE(t.avgServiceTime, 0) / 3600) AS INT64), CAST(FLOOR(MOD(CAST(COALESCE(t.avgServiceTime, 0) AS INT64), 3600) / 60) AS INT64), CAST(MOD(CAST(COALESCE(t.avgServiceTime, 0) AS INT64), 60) AS INT64)) as tiempoServicio,
      FORMAT('%02d:%02d:%02d', CAST(FLOOR(COALESCE(t.avgWaitingTime, 0) / 3600) AS INT64), CAST(FLOOR(MOD(CAST(COALESCE(t.avgWaitingTime, 0) AS INT64), 3600) / 60) AS INT64), CAST(MOD(CAST(COALESCE(t.avgWaitingTime, 0) AS INT64), 60) AS INT64)) as tiempoEspera,
      FORMAT('%02d:%02d:%02d', CAST(FLOOR(COALESCE(a.totalServiceTimeSeconds, 0) / 3600) AS INT64), CAST(FLOOR(MOD(CAST(COALESCE(a.totalServiceTimeSeconds, 0) AS INT64), 3600) / 60) AS INT64), CAST(MOD(CAST(COALESCE(a.totalServiceTimeSeconds, 0) AS INT64), 60) AS INT64)) as tiempoTotalServicio,
      FORMAT('%02d:%02d:%02d', 
        CAST(FLOOR(SAFE_DIVIDE(COALESCE(a.totalServiceTimeSeconds, 0), COALESCE(a.agentes, 1)) / 3600) AS INT64), 
        CAST(FLOOR(MOD(CAST(SAFE_DIVIDE(COALESCE(a.totalServiceTimeSeconds, 0), COALESCE(a.agentes, 1)) AS INT64), 3600) / 60) AS INT64), 
        CAST(MOD(CAST(SAFE_DIVIDE(COALESCE(a.totalServiceTimeSeconds, 0), COALESCE(a.agentes, 1)) AS INT64), 60) AS INT64)
      ) as ttsPorAgente,
      CAST(COALESCE(a.agentes, 0) AS INT64) as agentes,
      CAST(COALESCE(a.turnosAtendidosReales, 0) AS INT64) as turnosAtendidosReales
    FROM TurnsData t
    LEFT JOIN AgentsData a ON a.ServiceId = t.ServiceId
  `;

  try {
    const [rows] = await bigquery.query({ query });
    res.json(rows);
  } catch (error) {
    console.error('Error in services query:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agents-detail', async (req, res) => {
  const { date, hour, unitName, serviceName } = req.query;

  if (!date || !hour || !unitName) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const hourInt = parseInt(hour.substring(0, 2), 10);
  const hourStr = hourInt.toString().padStart(2, '0');
  // Safer Next Hour Logic
  // We use TIMESTAMP_ADD on the start of the hour to get the end of the window (start of next hour)

  const query = `
    WITH ServiceTimes AS (
      SELECT 
        s.UserId,
        COALESCE(u.FullName, CAST(s.UserId AS STRING)) as agente,
        'En Servicio' as estado,
        SUM(
            GREATEST(0,
                TIMESTAMP_DIFF(
                    LEAST(
                        TIMESTAMP_ADD(CAST(s.StartDate AS TIMESTAMP), INTERVAL s.Duration SECOND), 
                        TIMESTAMP_ADD(TIMESTAMP('${date} ${hourStr}:00:00'), INTERVAL 1 HOUR)
                    ),
                    GREATEST(
                        CAST(s.StartDate AS TIMESTAMP), 
                        TIMESTAMP('${date} ${hourStr}:00:00')
                    ),
                    SECOND
                )
            )
        ) as segundos
      FROM \`master-reactor-476520-p0.Dislive.AgentServiceTime\` s
      LEFT JOIN \`master-reactor-476520-p0.Dislive.UserFullNameStatus\` u ON s.UserId = u.UserId
      WHERE s.UnitId IN (SELECT DISTINCT UnitId FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\` WHERE UnitName = '${unitName}')
        AND DATE(s.StartDate) = '${date}'
        AND (
          EXTRACT(HOUR FROM s.StartDate) = ${hourInt} 
          OR 
          EXTRACT(HOUR FROM TIMESTAMP_ADD(CAST(s.StartDate AS TIMESTAMP), INTERVAL s.Duration SECOND)) = ${hourInt}
        )
        ${serviceName ? `AND s.ServiceId IN (SELECT DISTINCT ServiceId FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\` WHERE ServiceName = '${serviceName}')` : ''}
      GROUP BY 1, 2
    ),
    BackOfficeTimes AS (
      SELECT 
        b.UserId,
        COALESCE(u.FullName, CAST(b.UserId AS STRING)) as agente,
        COALESCE(b.BackOfficeTaskName, 'BackOffice') as estado,
        SUM(
            GREATEST(0,
                TIMESTAMP_DIFF(
                    LEAST(
                        TIMESTAMP_ADD(CAST(b.EventDate AS TIMESTAMP), INTERVAL b.Duration SECOND), 
                        TIMESTAMP_ADD(TIMESTAMP('${date} ${hourStr}:00:00'), INTERVAL 1 HOUR)
                    ),
                    GREATEST(
                        CAST(b.EventDate AS TIMESTAMP), 
                        TIMESTAMP('${date} ${hourStr}:00:00')
                    ),
                    SECOND
                )
            )
        ) as segundos
      FROM \`master-reactor-476520-p0.Dislive.AgentsBackOffice\` b
      LEFT JOIN \`master-reactor-476520-p0.Dislive.UserFullNameStatus\` u ON b.UserId = u.UserId
      WHERE DATE(b.EventDate) = '${date}'
        AND b.UnitId IN (SELECT DISTINCT UnitId FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\` WHERE UnitName = '${unitName}')
        AND (
          EXTRACT(HOUR FROM b.EventDate) = ${hourInt} 
          OR 
          EXTRACT(HOUR FROM TIMESTAMP_ADD(CAST(b.EventDate AS TIMESTAMP), INTERVAL b.Duration SECOND)) = ${hourInt}
        )
      GROUP BY 1, 2, 3
    ),
    SignedOutTimes AS (
      SELECT 
        s.UserId,
        COALESCE(u.FullName, CAST(s.UserId AS STRING)) as agente,
        COALESCE(s.StatusName, 'Deslogueado') as estado,
        SUM(
            GREATEST(0,
                TIMESTAMP_DIFF(
                    LEAST(
                        TIMESTAMP_ADD(CAST(s.EventDate AS TIMESTAMP), INTERVAL s.Duration SECOND), 
                        TIMESTAMP_ADD(TIMESTAMP('${date} ${hourStr}:00:00'), INTERVAL 1 HOUR)
                    ),
                    GREATEST(
                        CAST(s.EventDate AS TIMESTAMP), 
                        TIMESTAMP('${date} ${hourStr}:00:00')
                    ),
                    SECOND
                )
            )
        ) as segundos
      FROM \`master-reactor-476520-p0.Dislive.AgentsSignedOut\` s
      LEFT JOIN \`master-reactor-476520-p0.Dislive.UserFullNameStatus\` u ON s.UserId = u.UserId
      WHERE DATE(s.EventDate) = '${date}'
        AND s.UnitId IN (SELECT DISTINCT UnitId FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\` WHERE UnitName = '${unitName}')
        AND (
          EXTRACT(HOUR FROM s.EventDate) = ${hourInt} 
          OR 
          EXTRACT(HOUR FROM TIMESTAMP_ADD(CAST(s.EventDate AS TIMESTAMP), INTERVAL s.Duration SECOND)) = ${hourInt}
        )
      GROUP BY 1, 2, 3
    ),
    IdleTimes AS (
      SELECT 
        i.UserId,
        COALESCE(u.FullName, CAST(i.UserId AS STRING)) as agente,
        COALESCE(i.StatusName, 'Inactivo') as estado,
        SUM(
            GREATEST(0,
                TIMESTAMP_DIFF(
                    LEAST(
                        TIMESTAMP_ADD(CAST(i.EventDate AS TIMESTAMP), INTERVAL i.IdleSeconds SECOND), 
                        TIMESTAMP_ADD(TIMESTAMP('${date} ${hourStr}:00:00'), INTERVAL 1 HOUR)
                    ),
                    GREATEST(
                        CAST(i.EventDate AS TIMESTAMP), 
                        TIMESTAMP('${date} ${hourStr}:00:00')
                    ),
                    SECOND
                )
            )
        ) as segundos
      FROM \`master-reactor-476520-p0.Dislive.TimeIdleDetail\` i
      LEFT JOIN \`master-reactor-476520-p0.Dislive.UserFullNameStatus\` u ON i.UserId = u.UserId
      WHERE DATE(i.EventDate) = '${date}'
        AND i.UnitId IN (SELECT DISTINCT UnitId FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\` WHERE UnitName = '${unitName}')
        AND (
          EXTRACT(HOUR FROM i.EventDate) = ${hourInt} 
          OR 
          EXTRACT(HOUR FROM TIMESTAMP_ADD(CAST(i.EventDate AS TIMESTAMP), INTERVAL i.IdleSeconds SECOND)) = ${hourInt}
        )
      GROUP BY 1, 2, 3
    )
    SELECT agente, estado, segundos FROM ServiceTimes
    UNION ALL
    SELECT agente, estado, segundos FROM BackOfficeTimes
    UNION ALL
    SELECT agente, estado, segundos FROM SignedOutTimes
    UNION ALL
    SELECT agente, estado, segundos FROM IdleTimes
  `;

  try {
    const [rows] = await bigquery.query({ query });
    res.json(rows);
  } catch (error) {
    console.error('Error in agents-detail query:', error);
    res.status(500).json({ error: error.message });
  }
});

// Drill-down: list individual agents for a specific unit from live table
app.get('/api/agents-by-unit', async (req, res) => {
  const { unitName, agentType } = req.query;
  if (!unitName) {
    return res.status(400).json({ error: 'Missing unitName parameter' });
  }

  // Translate card type to AgentState SQL filter
  const stateFilters = {
    AgentsSignedIn: `a.AgentState <> 'LoggedOut'`,
    AgentsInService: `a.AgentState = 'InService'`,
    AgentsIdle: `a.AgentState = 'Idle'`,
    AgentsInBackOffice: `a.AgentState = 'BackOffice'`,
    AgentsInReception: `a.AgentState = 'Reception'`,
  };
  const stateClause = stateFilters[agentType] || `a.AgentState <> 'LoggedOut'`;

  const query = `
    SELECT
      a.UserId,
      a.FullName,
      a.FunctionName,
      a.AgentState
    FROM \`master-reactor-476520-p0.Dislive.UnitSupervisorDashboardRegional_Agents\` a
    WHERE CAST(a.UnitId AS INT64) IN (
      SELECT DISTINCT CAST(UnitId AS INT64)
      FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\`
      WHERE UnitName = '${unitName.replace(/'/g, "\\'")}'
    )
    AND ${stateClause}
    ORDER BY a.FullName
  `;

  try {
    const [rows] = await bigquery.query({ query });
    res.json(rows);
  } catch (error) {
    console.error('Error in agents-by-unit query:', error);
    res.status(500).json({ error: error.message });
  }
});

// All active agents for AI context
app.get('/api/all-agents', async (req, res) => {
  const query = `
    SELECT
      a.FullName,
      a.FunctionName,
      a.AgentState,
      u.UnitName
    FROM \`master-reactor-476520-p0.Dislive.UnitSupervisorDashboardRegional_Agents\` a
    LEFT JOIN (
      SELECT DISTINCT CAST(UnitId AS INT64) AS UnitId, UnitName
      FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\`
    ) u ON CAST(a.UnitId AS INT64) = u.UnitId
    WHERE a.AgentState <> 'LoggedOut'
    ORDER BY u.UnitName, a.AgentState, a.FullName
  `;
  try {
    const [rows] = await bigquery.query({ query });
    res.json(rows);
  } catch (error) {
    console.error('Error in all-agents query:', error);
    res.status(500).json({ error: error.message });
  }
});

// Individual tickets currently waiting in a specific unit
app.get('/api/waiting-tickets', async (req, res) => {
  const { unitName, date } = req.query;
  if (!unitName) return res.status(400).json({ error: 'Missing unitName' });
  const targetDate = date || new Date().toISOString().split('T')[0];

  console.log(`[API] /waiting-tickets called for unit: ${unitName}, date: ${targetDate}`);

  // Use the exact date to prevent 'zombie' tickets from previous days
  const query = `
    WITH RankedRows AS (
      SELECT
        ProcessId,
        ServiceName,
        Oficina,
        StartDate,
        EntityStatus,
        WaitingTimeWarning,
        WaitingTimeCritical,
        ROW_NUMBER() OVER (PARTITION BY ProcessId ORDER BY StartDate DESC) AS rn_last,
        MIN(IF(EntityStatus IN (3,11), StartDate, NULL)) OVER (PARTITION BY ProcessId) AS WaitStartDate
      FROM \`master-reactor-476520-p0.Dislive.Turnos_Detalle\`
      WHERE DATE(StartDate) = DATE('${targetDate}')
        AND EntityStatus NOT IN (40, 41)
        AND IFNULL(CAST(Resolution AS STRING), '') <> '4'
        AND UPPER(Oficina) LIKE UPPER('%${unitName.replace(/'/g, "\\'")}%')
    )
    SELECT
      ProcessId,
      ServiceName,
      WaitingTimeWarning,
      WaitingTimeCritical,
      FORMAT_DATETIME('%Y-%m-%dT%H:%M:%S', DATETIME(WaitStartDate)) AS StartDate,
      DATETIME_DIFF(CURRENT_DATETIME('America/Bogota'), DATETIME(WaitStartDate), SECOND) AS SecondsWaiting
      -- Se mantiene DATETIME_DIFF por ahora para StartDate, pero usaremos TIMESTAMP para los cálculos de Max
    FROM RankedRows
    WHERE rn_last = 1
      AND EntityStatus IN (3, 11)
    ORDER BY WaitStartDate ASC
  `;

  console.log(`[API] Executing query: \n${query}`);

  try {
    const [rows] = await bigquery.query({ query });
    console.log(`[API] /waiting-tickets returned ${rows.length} rows`);
    res.json(rows);
  } catch (error) {
    console.error('Error in waiting-tickets query:', error);
    res.status(500).json({ error: error.message });
  }
});

// Individual tickets currently in service in a specific unit
app.get('/api/service-tickets', async (req, res) => {
  const { unitName, date } = req.query;
  if (!unitName) return res.status(400).json({ error: 'Missing unitName' });
  const targetDate = date || new Date().toISOString().split('T')[0];

  console.log(`[API] /service-tickets called for unit: ${unitName}, date: ${targetDate}`);

  // Use the exact date to prevent 'zombie' tickets from previous days
  const query = `
    WITH RankedRows AS (
      SELECT
        ProcessId,
        ServiceName,
        Oficina,
        StartDate,
        EntityStatus,
        ServiceTimeWarning,
        ServiceTimeCritical,
        ROW_NUMBER() OVER (PARTITION BY ProcessId ORDER BY StartDate DESC) AS rn_last,
        MIN(IF(EntityStatus = 6, StartDate, NULL)) OVER (PARTITION BY ProcessId) AS ServiceStartDate
      FROM \`master-reactor-476520-p0.Dislive.Turnos_Detalle\`
      WHERE DATE(StartDate) = DATE('${targetDate}')
        AND EntityStatus NOT IN (40, 41)
        AND IFNULL(CAST(Resolution AS STRING), '') <> '4'
        AND UPPER(Oficina) LIKE UPPER('%${unitName.replace(/'/g, "\\'")}%')
    )
    SELECT
      ProcessId,
      ServiceName,
      ServiceTimeWarning,
      ServiceTimeCritical,
      FORMAT_DATETIME('%Y-%m-%dT%H:%M:%S', DATETIME(ServiceStartDate)) AS StartDate,
      DATETIME_DIFF(CURRENT_DATETIME('America/Bogota'), DATETIME(ServiceStartDate), SECOND) AS SecondsServing
    FROM RankedRows
    WHERE rn_last = 1
      AND EntityStatus = 6
    ORDER BY ServiceStartDate ASC
  `;

  console.log(`[API] Executing query: \n${query}`);

  try {
    const [rows] = await bigquery.query({ query });
    console.log(`[API] /service-tickets returned ${rows.length} rows`);
    res.json(rows);
  } catch (error) {
    console.error('Error in service-tickets query:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/query/global-stats', async (req, res) => {
  const { date, unitName, serviceName } = req.query;
  const query = `
    WITH StatsData AS (
      SELECT 
        AVG(AvgWaitingTime) as avgWaitingTime,
        AVG(AvgServiceTime) as avgServiceTime,
        AVG(WaitingTimeWarning) as waitingTimeWarning,
        AVG(WaitingTimeCritical) as waitingTimeCritical,
        AVG(ServiceTimeWarning) as serviceTimeWarning,
        AVG(ServiceTimeCritical) as serviceTimeCritical,
        SUM(Served) as totalAtendidos,
        SUM(Abandoned) as totalAbandonados
      FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\`
      WHERE DATE(StartDate) = '${date}'
      ${unitName ? `AND UnitName = '${unitName}'` : ''}
      ${serviceName ? `AND ServiceName = '${serviceName}'` : ''}
    ),
    AgentData AS (
      SELECT 
        COUNT(DISTINCT UserId) as totalAgentes,
        SUM(Duration) as totalServiceTimeSeconds
      FROM \`master-reactor-476520-p0.Dislive.AgentServiceTime\`
      WHERE DATE(StartDate) = '${date}'
      ${unitName ? `AND UnitId IN (SELECT DISTINCT UnitId FROM \`master-reactor-476520-p0.Dislive.UnitServiceRegionalP\` WHERE UnitName = '${unitName}')` : ''}
    )
    SELECT 
      FORMAT_TIMESTAMP('%H:%M:%S', TIMESTAMP_SECONDS(CAST(COALESCE(s.avgWaitingTime, 0) AS INT64))) as avgWaitingTime,
      FORMAT_TIMESTAMP('%H:%M:%S', TIMESTAMP_SECONDS(CAST(COALESCE(s.avgServiceTime, 0) AS INT64))) as avgServiceTime,
      COALESCE(s.waitingTimeWarning, 0) as waitingTimeWarning,
      COALESCE(s.waitingTimeCritical, 0) as waitingTimeCritical,
      COALESCE(s.serviceTimeWarning, 0) as serviceTimeWarning,
      COALESCE(s.serviceTimeCritical, 0) as serviceTimeCritical,
      COALESCE(s.totalAtendidos, 0) as totalAtendidos,
      COALESCE(s.totalAbandonados, 0) as totalAbandonados,
      COALESCE(a.totalAgentes, 0) as totalAgentes,
      FORMAT('%02d:%02d:%02d', 
        CAST(FLOOR(COALESCE(a.totalServiceTimeSeconds, 0) / 3600) AS INT64), 
        CAST(FLOOR(MOD(CAST(COALESCE(a.totalServiceTimeSeconds, 0) AS INT64), 3600) / 60) AS INT64), 
        CAST(MOD(CAST(COALESCE(a.totalServiceTimeSeconds, 0) AS INT64), 60) AS INT64)
      ) as totalServiceTime
    FROM StatsData s, AgentData a
  `;

  try {
    const [rows] = await bigquery.query({ query });
    res.json(rows[0] || { avgWaitingTime: '00:00:00', avgServiceTime: '00:00:00' });
  } catch (error) {
    console.error('Error in global stats query:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/daily-analysis', async (req, res) => {
  const filePath = 'C:\\Users\\cburgos\\OneDrive - Tveez Colombia S.A\\Documentos\\BigData\\Global\\Analisis por dia todos los clientes\\ReportesDiarios.xlsx';

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo ReportesDiarios.xlsx no encontrado' });
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet);

    if (rawData.length < 2) return res.json([]);

    // Log primeras filas para debugging
    console.log('=== Excel Raw Data Sample ===');
    console.log('First row (headers):', rawData[0]);
    console.log('Second row (data):', rawData[1]);
    console.log('Third row (data):', rawData[2]);
    console.log('Column keys:', Object.keys(rawData[1] || {}));
    console.log('--- Checking interval columns (H to M) ---');
    if (rawData[0]) {
      console.log('__EMPTY_6:', rawData[0]['__EMPTY_6']);
      console.log('__EMPTY_7:', rawData[0]['__EMPTY_7']);
      console.log('__EMPTY_8:', rawData[0]['__EMPTY_8']);
      console.log('__EMPTY_9:', rawData[0]['__EMPTY_9']);
      console.log('__EMPTY_10:', rawData[0]['__EMPTY_10']);
      console.log('__EMPTY_11:', rawData[0]['__EMPTY_11']);
    }
    console.log('=============================');

    // DYNAMIC COLUMN MAPPING - Find columns by header name instead of hardcoded positions
    // This makes the code resilient to Excel structure changes
    const headers = rawData[0] || {};
    const columnMap = {};

    // Map header names to their __EMPTY_X keys
    Object.keys(headers).forEach(key => {
      const headerName = (headers[key] || '').toString().toLowerCase().trim();

      if (headerName.includes('fecha')) columnMap.fecha = key;
      else if (headerName.includes('cliente')) columnMap.cliente = key;
      else if (headerName.includes('unidad')) columnMap.unidad = key;
      else if (headerName.includes('prom') && headerName.includes('servicio')) columnMap.tiempoServicio = key;
      else if (headerName.includes('prom') && headerName.includes('espera')) columnMap.tiempoEspera = key;
      else if (headerName.includes('<=1:00') || headerName === '<=1:00') columnMap.interval1 = key;
      else if (headerName.includes('<=2:00') || headerName === '<=2:00') columnMap.interval2 = key;
      else if (headerName.includes('<=3:00') || headerName === '<=3:00') columnMap.interval3 = key;
      else if (headerName.includes('<=4:00') || headerName === '<=4:00') columnMap.interval4 = key;
      else if (headerName.includes('<=5:00') || headerName === '<=5:00') columnMap.interval5 = key;
      else if (headerName.includes('>5:00') || headerName === '>5:00') columnMap.interval6 = key;
      else if (headerName.includes('total atendido')) columnMap.atendidos = key;
      else if (headerName.includes('atendido o abandonado')) columnMap.totalTurnos = key;
      else if (headerName.includes('total abandono')) columnMap.abandonos = key;
    });

    console.log('=== DYNAMIC COLUMN MAPPING ===');
    console.log('Column map:', columnMap);
    console.log('===============================');

    // Map raw data using the DYNAMIC column mapping
    // This will work even if Excel columns are reordered or new columns are added

    const mapped = rawData.slice(1).map(row => {
      // Excel Serial to JS Date - handle multiple formats
      let fechaStr = 'Unknown';
      const fechaRaw = row[columnMap.fecha]; // Use dynamic mapping for fecha

      if (fechaRaw) {
        if (typeof fechaRaw === 'number') {
          // Excel serial number
          const date = new Date(Math.round((fechaRaw - 25569) * 86400 * 1000));
          fechaStr = date.toISOString().split('T')[0];
        } else if (typeof fechaRaw === 'string') {
          // Try to parse as date string
          const parsedDate = new Date(fechaRaw);
          if (!isNaN(parsedDate.getTime())) {
            fechaStr = parsedDate.toISOString().split('T')[0];
          } else {
            // Try to extract date from string formats:
            // YYYY-MM-DD, M/D/YYYY, MM/DD/YYYY, D/M/YYYY, DD/MM/YYYY
            const isoMatch = fechaRaw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            const slashMatch = fechaRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);

            if (isoMatch) {
              // YYYY-MM-DD format
              const year = isoMatch[1];
              const month = isoMatch[2].padStart(2, '0');
              const day = isoMatch[3].padStart(2, '0');
              fechaStr = `${year}-${month}-${day}`;
            } else if (slashMatch) {
              // M/D/YYYY or D/M/YYYY format - assume M/D/YYYY (US format)
              const part1 = slashMatch[1];
              const part2 = slashMatch[2];
              const year = slashMatch[3];
              const month = part1.padStart(2, '0');
              const day = part2.padStart(2, '0');
              fechaStr = `${year}-${month}-${day}`;
            }
          }
        } else if (fechaRaw instanceof Date) {
          // Already a Date object
          fechaStr = fechaRaw.toISOString().split('T')[0];
        }
      }

      return {
        fecha: fechaStr,
        cliente: (row[columnMap.cliente] || 'Otros').toString().trim(),
        unidad: (() => {
          const val = (row[columnMap.unidad] || '').toString().trim();
          if (val === '> Clínica El Bosque' || val.toLowerCase().includes('clinica el bosque')) {
            return '> Centro Médico El Bosque';
          }
          return val;
        })(),
        tiempoServicio: row[columnMap.tiempoServicio] || '00:00:00',  // Prom. Tiempo de Servicio
        tiempoEspera: row[columnMap.tiempoEspera] || '00:00:00',    // Prom. Tiempo de Espera
        // Interval columns
        interval1: Number(row[columnMap.interval1]) || 0,  // <=1:00
        interval2: Number(row[columnMap.interval2]) || 0,  // <=2:00
        interval3: Number(row[columnMap.interval3]) || 0,  // <=3:00
        interval4: Number(row[columnMap.interval4]) || 0, // <=4:00
        interval5: Number(row[columnMap.interval5]) || 0, // <=5:00
        interval6: Number(row[columnMap.interval6]) || 0, // >5:00
        // Metrics columns
        atendidos: Number(row[columnMap.atendidos]) || 0,   // Total Atendido
        totalTurnos: Number(row[columnMap.totalTurnos]) || 0, // Atendido o Abandonado (Total Turnos)
        abandonos: Number(row[columnMap.abandonos]) || 0    // Total Abandono
      };
    });

    // Log first mapped item to verify column mapping
    console.log('=== First Mapped Item ===');
    console.log('Fecha:', mapped[0]?.fecha);
    console.log('Cliente:', mapped[0]?.cliente);
    console.log('Unidad:', mapped[0]?.unidad);
    console.log('TiempoServicio:', mapped[0]?.tiempoServicio);
    console.log('TiempoEspera:', mapped[0]?.tiempoEspera);
    console.log('--- Interval values for first row ---');
    console.log('interval1 (<=1:00):', mapped[0]?.interval1);
    console.log('interval2 (<=2:00):', mapped[0]?.interval2);
    console.log('interval3 (<=3:00):', mapped[0]?.interval3);
    console.log('interval4 (<=4:00):', mapped[0]?.interval4);
    console.log('interval5 (<=5:00):', mapped[0]?.interval5);
    console.log('interval6 (>5:00):', mapped[0]?.interval6);
    console.log('Total intervals:', (mapped[0]?.interval1 || 0) + (mapped[0]?.interval2 || 0) +
      (mapped[0]?.interval3 || 0) + (mapped[0]?.interval4 || 0) +
      (mapped[0]?.interval5 || 0) + (mapped[0]?.interval6 || 0));
    console.log('--- Raw first row for time columns ---');
    if (rawData[1]) {
      console.log('__EMPTY_3:', rawData[1]['__EMPTY_3']);
      console.log('__EMPTY_4:', rawData[1]['__EMPTY_4']);
      console.log('__EMPTY_5:', rawData[1]['__EMPTY_5']);
      console.log('__EMPTY_6:', rawData[1]['__EMPTY_6']);
      console.log('__EMPTY_7:', rawData[1]['__EMPTY_7']);
    }
    console.log('--- Raw first row for metrics (R, S, T columns) ---');
    if (rawData[1]) {
      console.log('__EMPTY_15:', rawData[1]['__EMPTY_15']);
      console.log('__EMPTY_16:', rawData[1]['__EMPTY_16']);
      console.log('__EMPTY_17:', rawData[1]['__EMPTY_17'], '← totalTurnos');
      console.log('__EMPTY_18:', rawData[1]['__EMPTY_18'], '← abandonos');
      console.log('__EMPTY_19:', rawData[1]['__EMPTY_19']);
      console.log('__EMPTY_20:', rawData[1]['__EMPTY_20']);
      console.log('__EMPTY_21:', rawData[1]['__EMPTY_21']);
      console.log('__EMPTY_22:', rawData[1]['__EMPTY_22']);
    }
    console.log('Mapped atendidos:', mapped[0]?.atendidos);
    console.log('Mapped totalTurnos:', mapped[0]?.totalTurnos);
    console.log('Mapped abandonos:', mapped[0]?.abandonos);
    console.log('--- Mapped interval values (first row) ---');
    console.log('interval1:', mapped[0]?.interval1);
    console.log('interval2:', mapped[0]?.interval2);
    console.log('interval3:', mapped[0]?.interval3);
    console.log('interval4:', mapped[0]?.interval4);
    console.log('interval5:', mapped[0]?.interval5);
    console.log('interval6:', mapped[0]?.interval6);
    console.log('Total intervals:', (mapped[0]?.interval1 || 0) + (mapped[0]?.interval2 || 0) +
      (mapped[0]?.interval3 || 0) + (mapped[0]?.interval4 || 0) +
      (mapped[0]?.interval5 || 0) + (mapped[0]?.interval6 || 0));
    console.log('=========================');

    // Group by Cliente and Fecha
    const grouped = {};
    mapped.forEach(item => {
      const key = `${item.cliente}|${item.fecha}`;
      if (!grouped[key]) {
        grouped[key] = {
          cliente: item.cliente,
          fecha: item.fecha,
          unidadesSet: new Set(),
          atendidos: 0,
          abandonos: 0,
          totalTurnos: 0,
          // WEIGHTED AVERAGE (correct calculation)
          sumWeightedWait: 0,  // Sum of (tiempoEspera * totalIntervals)
          sumIntervals: 0,      // Sum of all intervals
          sumWeightedServ: 0,  // Sum of (tiempoServicio * atendidos)
          sumAtendidos: 0       // Sum of atendidos (used as weight)
        };
      }
      const g = grouped[key];
      g.unidadesSet.add(item.unidad);
      g.atendidos += item.atendidos;
      g.abandonos += item.abandonos;
      g.totalTurnos += item.totalTurnos;

      // Calculate total intervals for this row
      const totalIntervals = item.interval1 + item.interval2 + item.interval3 +
        item.interval4 + item.interval5 + item.interval6;

      // Weighted wait time: tiempoEspera * totalIntervals
      const wSec = timeToSeconds(item.tiempoEspera);
      if (totalIntervals > 0 && wSec > 0) {
        g.sumWeightedWait += wSec * totalIntervals;
        g.sumIntervals += totalIntervals;
      }

      // Weighted service time: tiempoServicio * atendidos
      const sSec = timeToSeconds(item.tiempoServicio);
      if (item.atendidos > 0 && sSec > 0) {
        g.sumWeightedServ += sSec * item.atendidos;
        g.sumAtendidos += item.atendidos;
      }
    });

    const finalData = Object.values(grouped).map(g => ({
      cliente: g.cliente,
      fecha: g.fecha,
      unidades: g.unidadesSet.size,
      atendidos: g.atendidos,
      abandonos: g.abandonos,
      totalTurnos: g.totalTurnos,
      // Weighted average wait time: (Sum of Time*Intervals) / (Sum of Intervals)
      avgWaitTime: secondsToTime(g.sumIntervals > 0 ? g.sumWeightedWait / g.sumIntervals : 0),
      // Weighted average service time: (Sum of Time*Atendidos) / (Sum of Atendidos)
      avgServTime: secondsToTime(g.sumAtendidos > 0 ? g.sumWeightedServ / g.sumAtendidos : 0),
      unidadesDetalle: Array.from(g.unidadesSet) // Lista de unidades para drill-down
    }));

    // Log para depuración
    console.log('Daily Analysis - Processed clients:', finalData.map(d => ({
      cliente: d.cliente,
      fecha: d.fecha,
      unidades: d.unidades
    })));

    // También incluir datos sin agrupar para drill-down por unidad
    const detailData = mapped.map(item => ({
      cliente: item.cliente,
      fecha: item.fecha,
      unidad: item.unidad,
      atendidos: item.atendidos,
      abandonos: item.abandonos,
      totalTurnos: item.totalTurnos,
      tiempoEspera: item.tiempoEspera,
      tiempoServicio: item.tiempoServicio
    }));

    res.json({ summary: finalData, details: detailData });
  } catch (error) {
    console.error('Error processing daily analysis:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para obtener datos de tendencia de 30 días para un cliente específico
app.get('/api/daily-analysis/trend/:clientName', async (req, res) => {
  try {
    const { clientName } = req.params;
    const filePath = 'C:\\Users\\cburgos\\OneDrive - Tveez Colombia S.A\\Documentos\\BigData\\Global\\Analisis por dia todos los clientes\\ReportesDiarios.xlsx';
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const normalize = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetCNorm = normalize(clientName);

    console.log(`=== Trend Data Request for Client: [${clientName}] -> [${targetCNorm}] ===`);

    // Mapear datos igual que en el endpoint principal
    const mapped = rawData.slice(1).map(row => {
      let fechaStr = 'Unknown';
      const fechaRaw = row['__EMPTY']; // __EMPTY contains the date

      if (fechaRaw) {
        if (typeof fechaRaw === 'number') {
          const date = new Date(Math.round((fechaRaw - 25569) * 86400 * 1000));
          fechaStr = date.toISOString().split('T')[0];
        } else if (typeof fechaRaw === 'string') {
          const parsedDate = new Date(fechaRaw);
          if (!isNaN(parsedDate.getTime())) {
            fechaStr = parsedDate.toISOString().split('T')[0];
          } else {
            const isoMatch = fechaRaw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            const slashMatch = fechaRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);

            if (isoMatch) {
              const year = isoMatch[1];
              const month = isoMatch[2].padStart(2, '0');
              const day = isoMatch[3].padStart(2, '0');
              fechaStr = `${year}-${month}-${day}`;
            } else if (slashMatch) {
              const part1 = slashMatch[1];
              const part2 = slashMatch[2];
              const year = slashMatch[3];
              const month = part1.padStart(2, '0');
              const day = part2.padStart(2, '0');
              fechaStr = `${year}-${month}-${day}`;
            }
          }
        } else if (fechaRaw instanceof Date) {
          fechaStr = fechaRaw.toISOString().split('T')[0];
        }
      }

      return {
        fecha: fechaStr,
        cliente: (row['__EMPTY_1'] || 'Otros').toString(),
        unidad: (() => {
          const val = (row['__EMPTY_2'] || '').toString().trim();
          if (val === '> Clínica El Bosque' || val.toLowerCase().includes('clinica el bosque')) {
            return '> Centro Médico El Bosque';
          }
          return val;
        })(),
        tiempoServicio: row['__EMPTY_3'] || '00:00:00',
        tiempoEspera: row['__EMPTY_5'] || '00:00:00',
        interval1: Number(row['__EMPTY_6']) || 0,
        interval2: Number(row['__EMPTY_7']) || 0,
        interval3: Number(row['__EMPTY_8']) || 0,
        interval4: Number(row['__EMPTY_10']) || 0,
        interval5: Number(row['__EMPTY_14']) || 0,
        interval6: Number(row['__EMPTY_15']) || 0,
        atendidos: Number(row['__EMPTY_16']) || 0,
        totalTurnos: Number(row['__EMPTY_17']) || 0,
        abandonos: Number(row['__EMPTY_18']) || 0
      };
    });

    // Filtrar por cliente y agrupar por fecha usando normalización
    const clientData = mapped.filter(d => normalize(d.cliente) === targetCNorm && d.fecha !== 'Unknown');

    const grouped = {};
    clientData.forEach(item => {
      const key = item.fecha;
      if (!grouped[key]) {
        grouped[key] = {
          fecha: item.fecha,
          unidades: 0,
          totalTurnos: 0,
          atendidos: 0,
          abandonos: 0,
          sumWeightedWait: 0,
          sumIntervals: 0,
          sumWeightedServ: 0,
          sumAtendidos: 0
        };
      }

      grouped[key].unidades += 1;
      grouped[key].totalTurnos += item.totalTurnos;
      grouped[key].atendidos += item.atendidos;
      grouped[key].abandonos += item.abandonos;

      const totalIntervals = item.interval1 + item.interval2 + item.interval3 + item.interval4 + item.interval5 + item.interval6;
      const waitSeconds = timeToSeconds(item.tiempoEspera);
      grouped[key].sumWeightedWait += waitSeconds * totalIntervals;
      grouped[key].sumIntervals += totalIntervals;

      const servSeconds = timeToSeconds(item.tiempoServicio);
      grouped[key].sumWeightedServ += servSeconds * item.atendidos;
      grouped[key].sumAtendidos += item.atendidos;
    });

    // Convertir a array y calcular promedios
    const allTrendData = Object.values(grouped)
      .map(d => ({
        fecha: d.fecha,
        unidades: d.unidades,
        totalTurnos: d.totalTurnos,
        atendidos: d.atendidos,
        abandonos: d.abandonos,
        avgWaitTime: d.sumIntervals > 0 ? secondsToTime(d.sumWeightedWait / d.sumIntervals) : '00:00:00',
        avgServTime: d.sumAtendidos > 0 ? secondsToTime(d.sumWeightedServ / d.sumAtendidos) : '00:00:00'
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha)); // Ordenar por fecha ascendente

    // Mostrar todos los datos si hay menos de 30 días, sino mostrar últimos 30
    const trendData = allTrendData.length <= 30 ? allTrendData : allTrendData.slice(-30);

    console.log(`Trend data points for ${clientName}:`, trendData.length);
    res.json(trendData);
  } catch (error) {
    console.error('Error processing trend data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para obtener datos de tendencia de 30 días para una UNIDAD específica de un cliente
app.get('/api/daily-analysis/trend/:clientName/:unitName', async (req, res) => {
  try {
    const { clientName, unitName } = req.params;
    const filePath = 'C:\\Users\\cburgos\\OneDrive - Tveez Colombia S.A\\Documentos\\BigData\\Global\\Analisis por dia todos los clientes\\ReportesDiarios.xlsx';
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Función de normalización robusta para comparaciones
    const normalize = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

    const targetCNorm = normalize(clientName);
    const targetUNorm = normalize(unitName);

    console.log(`=== Trend Data Request for Client: [${clientName}] -> [${targetCNorm}], Unit: [${unitName}] -> [${targetUNorm}] ===`);

    const mapped = rawData.slice(1).map(row => {
      let fechaStr = 'Unknown';
      const fechaRaw = row['__EMPTY']; // __EMPTY contains the date

      if (fechaRaw) {
        if (typeof fechaRaw === 'number') {
          const date = new Date(Math.round((fechaRaw - 25569) * 86400 * 1000));
          fechaStr = date.toISOString().split('T')[0];
        } else if (typeof fechaRaw === 'string') {
          const parsedDate = new Date(fechaRaw);
          if (!isNaN(parsedDate.getTime())) {
            fechaStr = parsedDate.toISOString().split('T')[0];
          } else {
            const isoMatch = fechaRaw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            const slashMatch = fechaRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);

            if (isoMatch) {
              const year = isoMatch[1];
              const month = isoMatch[2].padStart(2, '0');
              const day = isoMatch[3].padStart(2, '0');
              fechaStr = `${year}-${month}-${day}`;
            } else if (slashMatch) {
              const part1 = slashMatch[1];
              const part2 = slashMatch[2];
              const year = slashMatch[3];
              const month = part1.padStart(2, '0');
              const day = part2.padStart(2, '0');
              fechaStr = `${year}-${month}-${day}`;
            }
          }
        } else if (fechaRaw instanceof Date) {
          fechaStr = fechaRaw.toISOString().split('T')[0];
        }
      }

      return {
        fecha: fechaStr,
        cliente: (row['__EMPTY_1'] || 'Otros').toString(),
        unidad: (() => {
          const val = (row['__EMPTY_2'] || '').toString().trim();
          if (val === '> Clínica El Bosque' || val.toLowerCase().includes('clinica el bosque')) {
            return '> Centro Médico El Bosque';
          }
          return (row['__EMPTY_2'] || 'Otros').toString();
        })(),
        tiempoServicio: row['__EMPTY_3'] || '00:00:00',
        tiempoEspera: row['__EMPTY_5'] || '00:00:00',
        interval1: Number(row['__EMPTY_6']) || 0,
        interval2: Number(row['__EMPTY_7']) || 0,
        interval3: Number(row['__EMPTY_8']) || 0,
        interval4: Number(row['__EMPTY_10']) || 0,
        interval5: Number(row['__EMPTY_14']) || 0,
        interval6: Number(row['__EMPTY_15']) || 0,
        atendidos: Number(row['__EMPTY_16']) || 0,
        totalTurnos: Number(row['__EMPTY_17']) || 0,
        abandonos: Number(row['__EMPTY_18']) || 0
      };
    });

    // Filtrar usando normalización robusta (ignora espacios, símbolos y mayúsculas)
    const filteredData = mapped.filter(d =>
      normalize(d.cliente) === targetCNorm &&
      normalize(d.unidad) === targetUNorm &&
      d.fecha !== 'Unknown'
    );

    console.log(`Found ${filteredData.length} raw data rows for filter.`);

    const grouped = {};
    filteredData.forEach(item => {
      const key = item.fecha;
      if (!grouped[key]) {
        grouped[key] = {
          fecha: item.fecha,
          totalTurnos: 0,
          atendidos: 0,
          abandonos: 0,
          sumWeightedWait: 0,
          sumIntervals: 0,
          sumWeightedServ: 0,
          sumAtendidos: 0
        };
      }

      grouped[key].totalTurnos += item.totalTurnos;
      grouped[key].atendidos += item.atendidos;
      grouped[key].abandonos += item.abandonos;

      const totalIntervals = item.interval1 + item.interval2 + item.interval3 + item.interval4 + item.interval5 + item.interval6;
      const waitSeconds = timeToSeconds(item.tiempoEspera);
      grouped[key].sumWeightedWait += waitSeconds * totalIntervals;
      grouped[key].sumIntervals += totalIntervals;

      const servSeconds = timeToSeconds(item.tiempoServicio);
      grouped[key].sumWeightedServ += servSeconds * item.atendidos;
      grouped[key].sumAtendidos += item.atendidos;
    });

    // Convertir a array y calcular promedios
    const allTrendData = Object.values(grouped)
      .map(d => ({
        fecha: d.fecha,
        unidades: 1,
        totalTurnos: d.totalTurnos,
        atendidos: d.atendidos,
        abandonos: d.abandonos,
        avgWaitTime: d.sumIntervals > 0 ? secondsToTime(d.sumWeightedWait / d.sumIntervals) : '00:00:00',
        avgServTime: d.sumAtendidos > 0 ? secondsToTime(d.sumWeightedServ / d.sumAtendidos) : '00:00:00'
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const trendData = allTrendData.length <= 30 ? allTrendData : allTrendData.slice(-30);

    console.log(`Trend data points for Client: ${clientName}, Unit: ${unitName}:`, trendData.length);
    res.json(trendData);
  } catch (error) {
    console.error('Error processing unit trend data:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projections', async (req, res) => {
  try {
    const { date, dateFrom, dateTo, unit, service } = req.query;
    let whereClauses = [];

    // Soporte para fecha única (retrocompatibilidad) o rango de fechas
    if (dateFrom && dateTo) {
      whereClauses.push(`DATE(fecha_proyeccion) BETWEEN '${dateFrom}' AND '${dateTo}'`);
    } else if (date) {
      whereClauses.push(`DATE(fecha_proyeccion) = '${date}'`);
    }

    // Filtro por unidad - ahora la vista tiene unidad_id
    if (unit) {
      whereClauses.push(`unidad_id = ${unit}`);
    }

    if (service) whereClauses.push(`servicio = '${service}'`);

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `SELECT * FROM \`master-reactor-476520-p0.Dislive.v_dashboard_plan_2026\` ${whereStr} ORDER BY hora`;

    console.log('Query de Proyecciones:', query);
    const [rows] = await bigquery.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching projections from BigQuery:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/live-data', async (req, res) => {
  try {
    const { unit, service, granularity = 'hour', date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // logic for dynamic "EsDeOficina" filter
    const officeFilter = unit ? `Oficina LIKE '${unit}%'` : '1=1';
    const serviceFilter = service ? `AND Servicio LIKE '${service}%'` : '';

    const detailQuery = granularity === 'minute' ? `
      WITH PasosLimpios AS (
          SELECT
              ProcessId, ServiceId, ServiceName AS Servicio, Oficina, Resolution,
              CASE WHEN EntityStatus IN (3, 11) THEN 3 ELSE EntityStatus END AS EntityStatus,
              SUM(Duration) AS Duration,
              MIN(StartDate) AS StartDate
          FROM (
              SELECT *,
                  ROW_NUMBER() OVER (
                      PARTITION BY ProcessId, IF(EntityStatus IN (3,11), 1, 0)
                      ORDER BY StartDate
                  ) AS rn
              FROM \`master-reactor-476520-p0.Dislive.Turnos_Detalle\`
              WHERE DATE(StartDate) = '${targetDate}'
                AND EntityStatus NOT IN (40,41)
                AND Resolution <> "4"
          ) t
          GROUP BY ProcessId, ServiceId, ServiceName, Oficina, Resolution,
                   CASE WHEN EntityStatus IN (3, 11) THEN 3 ELSE EntityStatus END, rn
      ),
      DetalleBase AS (
          SELECT 
              *,
              MAX(IF(${officeFilter}, 1, 0)) OVER(PARTITION BY ProcessId) AS EsDeOficina
          FROM PasosLimpios
      ),
      TimeSeries AS (
          SELECT 
              FORMAT_TIMESTAMP('%H:%M', TIMESTAMP_TRUNC(StartDate, MINUTE)) as Hora_Minuto,
              SUM(IF(EntityStatus = 6 AND Duration IS NOT NULL, 1, 0)) AS Atendidos,
              SUM(IF(EntityStatus = 4, 1, 0)) AS Abandonos,
              SUM(IF(EntityStatus = 3 AND Duration IS NOT NULL, 1, 0)) AS TurnosConEspera,
              AVG(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3', Duration, NULL)) AS Segundos_Espera,
              AVG(IF(EntityStatus = 6 AND Duration IS NOT NULL, Duration, NULL)) AS Segundos_Servicio
          FROM DetalleBase
          WHERE EsDeOficina = 1 ${serviceFilter}
          GROUP BY 1
      )
      SELECT *, (Atendidos + Abandonos) as Total_Turnos FROM TimeSeries ORDER BY Hora_Minuto
    ` : `
      WITH PasosLimpios AS (
          SELECT
              ProcessId, ServiceId, ServiceName AS Servicio, Oficina, Resolution,
              CASE WHEN EntityStatus IN (3, 11) THEN 3 ELSE EntityStatus END AS EntityStatus,
              SUM(Duration) AS Duration,
              MIN(StartDate) AS StartDate
          FROM (
              SELECT *,
                  ROW_NUMBER() OVER (
                      PARTITION BY ProcessId, IF(EntityStatus IN (3,11), 1, 0)
                      ORDER BY StartDate
                  ) AS rn
              FROM \`master-reactor-476520-p0.Dislive.Turnos_Detalle\`
              WHERE DATE(StartDate) = '${targetDate}'
                AND EntityStatus NOT IN (40,41)
                AND Resolution <> "4"
          ) t
          GROUP BY ProcessId, ServiceId, ServiceName, Oficina, Resolution,
                   CASE WHEN EntityStatus IN (3, 11) THEN 3 ELSE EntityStatus END, rn
      ),
      DetalleBase AS (
          SELECT 
              *,
              MAX(IF(${officeFilter}, 1, 0)) OVER(PARTITION BY ProcessId) AS EsDeOficina
          FROM PasosLimpios
      ),
      TimeSeries AS (
          SELECT 
              FORMAT_TIMESTAMP('%H:00', TIMESTAMP_TRUNC(StartDate, HOUR)) as Hora_Minuto,
              SUM(IF(EntityStatus = 6 AND Duration IS NOT NULL, 1, 0)) AS Atendidos,
              SUM(IF(EntityStatus = 4, 1, 0)) AS Abandonos,
              SUM(IF(EntityStatus = 3 AND Duration IS NOT NULL, 1, 0)) AS TurnosConEspera,
              AVG(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3', Duration, NULL)) AS Segundos_Espera,
              AVG(IF(EntityStatus = 6 AND Duration IS NOT NULL, Duration, NULL)) AS Segundos_Servicio
          FROM DetalleBase
          WHERE EsDeOficina = 1 ${serviceFilter}
          GROUP BY 1
      )
      SELECT *, (Atendidos + Abandonos) as Total_Turnos FROM TimeSeries ORDER BY Hora_Minuto
    `;

    const globalsQuery = `
      WITH PasosLimpios AS (
          SELECT
              ProcessId, ServiceId, ServiceName AS Servicio, Oficina, Resolution,
              CASE WHEN EntityStatus IN (3, 11) THEN 3 ELSE EntityStatus END AS EntityStatus,
              SUM(Duration) AS Duration,
              MIN(StartDate) AS StartDate,
              MAX(MAX(WaitingTimeStandard)) OVER(PARTITION BY ServiceName) as WaitingTimeStandard,
              MAX(MAX(WaitingTimeWarning)) OVER(PARTITION BY ServiceName) as WaitingTimeWarning,
              MAX(MAX(WaitingTimeCritical)) OVER(PARTITION BY ServiceName) as WaitingTimeCritical,
              MAX(MAX(ServiceTimeWarning)) OVER(PARTITION BY ServiceName) as ServiceTimeWarning,
              MAX(MAX(ServiceTimeCritical)) OVER(PARTITION BY ServiceName) as ServiceTimeCritical
          FROM (
              SELECT *,
                  ROW_NUMBER() OVER (
                      PARTITION BY ProcessId, IF(EntityStatus IN (3,11), 1, 0)
                      ORDER BY StartDate
                  ) AS rn
              FROM \`master-reactor-476520-p0.Dislive.Turnos_Detalle\`
              WHERE DATE(StartDate) = '${targetDate}'
                AND EntityStatus NOT IN (40,41)
                AND Resolution <> "4"
          ) t
          GROUP BY ProcessId, ServiceId, ServiceName, Oficina, Resolution,
                   CASE WHEN EntityStatus IN (3, 11) THEN 3 ELSE EntityStatus END, rn
      ),
      DetalleBase AS (
          SELECT 
              *,
              MAX(IF(${officeFilter}, 1, 0)) OVER(PARTITION BY ProcessId) AS EsDeOficina
          FROM PasosLimpios
      ),
      MetricasServicio AS (
          SELECT 
              Servicio,
              SUM(IF(EntityStatus = 6 AND Duration IS NOT NULL, 1, 0)) AS Served,
              SUM(IF(EntityStatus = 4, 1, 0)) AS Abandoned,
              AVG(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3', Duration, NULL)) AS AvgWait,
              AVG(IF(EntityStatus = 6 AND Duration IS NOT NULL, Duration, NULL)) AS AvgService,
              SUM(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3', 1, 0)) AS TotalWaiting,
              SUM(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3' AND Duration <= WaitingTimeStandard, 1, 0)) AS WaitWithinGoal,
              MAX(WaitingTimeWarning) as WaitingTimeWarning,
              MAX(WaitingTimeCritical) as WaitingTimeCritical,
              MAX(ServiceTimeWarning) as ServiceTimeWarning,
              MAX(ServiceTimeCritical) as ServiceTimeCritical
          FROM DetalleBase
          WHERE EsDeOficina = 1 ${serviceFilter}
          GROUP BY Servicio
      ),
      GlobalOficina AS (
          SELECT 
              SUM(IF(EntityStatus = 6 AND Duration IS NOT NULL, 1, 0)) AS Served,
              SUM(IF(EntityStatus = 4, 1, 0)) AS Abandoned,
              AVG(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3', Duration, NULL)) AS AvgWait,
              AVG(IF(EntityStatus = 6 AND Duration IS NOT NULL, Duration, NULL)) AS AvgService,
              SUM(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3', 1, 0)) AS TotalWaiting,
              SUM(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3' AND Duration <= WaitingTimeStandard, 1, 0)) AS WaitWithinGoal,
              AVG(WaitingTimeWarning) as AvgWaitingTimeWarning,
              AVG(WaitingTimeCritical) as AvgWaitingTimeCritical,
              AVG(ServiceTimeWarning) as AvgServiceTimeWarning,
              AVG(ServiceTimeCritical) as AvgServiceTimeCritical
          FROM DetalleBase
          WHERE EsDeOficina = 1
      ),
      GlobalGeneral AS (
          SELECT 
              SUM(IF(EntityStatus = 6 AND Duration IS NOT NULL, 1, 0)) AS Served,
              SUM(IF(EntityStatus = 4, 1, 0)) AS Abandoned,
              AVG(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3', Duration, NULL)) AS AvgWait,
              AVG(IF(EntityStatus = 6 AND Duration IS NOT NULL, Duration, NULL)) AS AvgService,
              SUM(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3', 1, 0)) AS TotalWaiting,
              SUM(IF(EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3' AND Duration <= WaitingTimeStandard, 1, 0)) AS WaitWithinGoal,
              AVG(WaitingTimeWarning) as Global_AvgWaitingTimeWarning,
              AVG(WaitingTimeCritical) as Global_AvgWaitingTimeCritical,
              AVG(ServiceTimeWarning) as Global_AvgServiceTimeWarning,
              AVG(ServiceTimeCritical) as Global_AvgServiceTimeCritical
          FROM DetalleBase
      ),
      -- Status Counters logic
      OficinasByStatus AS (
        SELECT
          SUM(CASE WHEN AvgEspera >= AvgCriticalEspera THEN 1 ELSE 0 END) AS Oficinas_Espera_Critical,
          SUM(CASE WHEN AvgEspera >= AvgWarningEspera AND AvgEspera < AvgCriticalEspera THEN 1 ELSE 0 END) AS Oficinas_Espera_Warning,
          SUM(CASE WHEN AvgServicio >= AvgCriticalServicio THEN 1 ELSE 0 END) AS Oficinas_Servicio_Critical,
          SUM(CASE WHEN AvgServicio >= AvgWarningServicio AND AvgServicio < AvgCriticalServicio THEN 1 ELSE 0 END) AS Oficinas_Servicio_Warning,
          COUNT(DISTINCT Oficina) AS Total_Oficinas
        FROM (
          SELECT 
            Oficina,
            AVG(CASE WHEN EntityStatus = 3 AND Resolution <> '3' THEN Duration END) AS AvgEspera,
            AVG(CASE WHEN EntityStatus = 6 THEN Duration END) AS AvgServicio,
            AVG(WaitingTimeCritical) AS AvgCriticalEspera,
            AVG(WaitingTimeWarning) AS AvgWarningEspera,
            AVG(ServiceTimeCritical) AS AvgCriticalServicio,
            AVG(ServiceTimeWarning) AS AvgWarningServicio
          FROM PasosLimpios
          GROUP BY Oficina
        )
      ),
      ServiciosByStatus AS (
        SELECT
          SUM(CASE WHEN AvgEspera >= WaitingTimeCritical THEN 1 ELSE 0 END) AS Servicios_Espera_Critical,
          SUM(CASE WHEN AvgEspera >= WaitingTimeWarning AND AvgEspera < WaitingTimeCritical THEN 1 ELSE 0 END) AS Servicios_Espera_Warning,
          SUM(CASE WHEN AvgServicio >= ServiceTimeCritical THEN 1 ELSE 0 END) AS Servicios_Servicio_Critical,
          SUM(CASE WHEN AvgServicio >= ServiceTimeWarning AND AvgServicio < ServiceTimeCritical THEN 1 ELSE 0 END) AS Servicios_Servicio_Warning,
          COUNT(DISTINCT Servicio) AS Total_Servicios
        FROM (
          SELECT 
            Servicio,
            AVG(CASE WHEN EntityStatus = 3 AND Resolution <> '3' THEN Duration END) AS AvgEspera,
            AVG(CASE WHEN EntityStatus = 6 THEN Duration END) AS AvgServicio,
            ANY_VALUE(WaitingTimeCritical) AS WaitingTimeCritical,
            ANY_VALUE(WaitingTimeWarning) AS WaitingTimeWarning,
            ANY_VALUE(ServiceTimeCritical) AS ServiceTimeCritical,
            ANY_VALUE(ServiceTimeWarning) AS ServiceTimeWarning
          FROM DetalleBase
          WHERE EsDeOficina = 1
          GROUP BY Servicio
        )
      ),
      OficinasByServiceStatus AS (
        SELECT
          SUM(CASE WHEN AvgEspera >= WaitingTimeCritical THEN 1 ELSE 0 END) AS Oficinas_Espera_Critical,
          SUM(CASE WHEN AvgEspera >= WaitingTimeWarning AND AvgEspera < WaitingTimeCritical THEN 1 ELSE 0 END) AS Oficinas_Espera_Warning,
          SUM(CASE WHEN AvgServicio >= ServiceTimeCritical THEN 1 ELSE 0 END) AS Oficinas_Servicio_Critical,
          SUM(CASE WHEN AvgServicio >= ServiceTimeWarning AND AvgServicio < ServiceTimeCritical THEN 1 ELSE 0 END) AS Oficinas_Servicio_Warning,
          COUNT(DISTINCT Oficina) AS Total_Oficinas
        FROM (
          SELECT 
            Oficina,
            AVG(CASE WHEN EntityStatus = 3 AND Resolution <> '3' THEN Duration END) AS AvgEspera,
            AVG(CASE WHEN EntityStatus = 6 THEN Duration END) AS AvgServicio,
            ANY_VALUE(WaitingTimeCritical) AS WaitingTimeCritical,
            ANY_VALUE(WaitingTimeWarning) AS WaitingTimeWarning,
            ANY_VALUE(ServiceTimeCritical) AS ServiceTimeCritical,
            ANY_VALUE(ServiceTimeWarning) AS ServiceTimeWarning
          FROM DetalleBase
          WHERE ${service ? `Servicio LIKE '${service}%'` : '1=1'}
          GROUP BY Oficina
        )
      ),
      RankingsUnidades_Srv AS (
          SELECT
              Oficina,
              Servicio,
              -- Accumulate raw sums/counts instead of AVG, so the parent CTE can do weighted AVG
              SUM(CASE WHEN EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3' THEN Duration ELSE 0 END) AS WaitSum,
              SUM(CASE WHEN EntityStatus = 3 AND Duration IS NOT NULL AND Resolution <> '3' THEN 1 ELSE 0 END) AS WaitCount,
              SUM(CASE WHEN EntityStatus = 6 AND Duration IS NOT NULL THEN Duration ELSE 0 END) AS ServiceSum,
              SUM(CASE WHEN EntityStatus = 6 AND Duration IS NOT NULL THEN 1 ELSE 0 END) AS ServiceCount,
              COUNT(DISTINCT ProcessId) AS TotalVolumen,
              SUM(CASE WHEN EntityStatus = 4 THEN 1 ELSE 0 END) AS TotalAbandonos,
              MAX(WaitingTimeStandard) as WaitingTimeStandard,
              MAX(WaitingTimeCritical) as WaitingTimeCritical,
              MAX(WaitingTimeWarning) as WaitingTimeWarning,
              MAX(ServiceTimeCritical) as ServiceTimeCritical,
              MAX(ServiceTimeWarning) as ServiceTimeWarning,
              SUM(CASE WHEN EntityStatus = 3 AND Duration IS NOT NULL AND Duration <= WaitingTimeStandard THEN 1 ELSE 0 END) AS WaitWithinGoal,
              SUM(CASE WHEN EntityStatus = 3 AND Duration IS NOT NULL THEN 1 ELSE 0 END) AS TotalWaitRows
          FROM DetalleBase
          ${service ? `WHERE Servicio LIKE '${service}%'` : ''}
          GROUP BY Oficina, Servicio
      ),
      RankingsUnidades AS (
          SELECT
              Oficina,
              -- Weighted average: SUM of all durations / COUNT of all rows (matches GlobalOficina calculation)
              SAFE_DIVIDE(SUM(WaitSum), NULLIF(SUM(WaitCount), 0)) AS AvgEspera,
              SAFE_DIVIDE(SUM(ServiceSum), NULLIF(SUM(ServiceCount), 0)) AS AvgServicio,
              SUM(TotalVolumen) AS TotalVolumen,
              SUM(TotalAbandonos) AS TotalAbandonos,
              AVG(WaitingTimeStandard) as WaitingTimeStandard,
              AVG(WaitingTimeCritical) as WaitingTimeCritical,
              AVG(WaitingTimeWarning) as WaitingTimeWarning,
              AVG(ServiceTimeCritical) as ServiceTimeCritical,
              AVG(ServiceTimeWarning) as ServiceTimeWarning,
              ROUND(SAFE_DIVIDE(SUM(WaitWithinGoal), SUM(TotalWaitRows)) * 100, 2) AS PorcentajeEnObjetivo
          FROM RankingsUnidades_Srv
          GROUP BY Oficina
      ),
      RankingsServicios AS (
          SELECT
              Servicio,
              AVG(CASE WHEN EntityStatus = 3 AND Duration IS NOT NULL THEN Duration END) AS AvgEspera,
              AVG(CASE WHEN EntityStatus = 6 AND Duration IS NOT NULL THEN Duration END) AS AvgServicio,
              COUNT(DISTINCT ProcessId) AS TotalVolumen,
              SUM(CASE WHEN EntityStatus = 4 THEN 1 ELSE 0 END) AS TotalAbandonos,
              MAX(WaitingTimeStandard) as WaitingTimeStandard,
              MAX(WaitingTimeCritical) as WaitingTimeCritical,
              MAX(WaitingTimeWarning) as WaitingTimeWarning,
              MAX(ServiceTimeCritical) as ServiceTimeCritical,
              MAX(ServiceTimeWarning) as ServiceTimeWarning,
              ROUND(SAFE_DIVIDE(SUM(CASE WHEN EntityStatus = 3 AND Duration IS NOT NULL AND Duration <= WaitingTimeStandard THEN 1 ELSE 0 END), SUM(CASE WHEN EntityStatus = 3 AND Duration IS NOT NULL THEN 1 ELSE 0 END)) * 100, 2) AS PorcentajeEnObjetivo
          FROM DetalleBase
          WHERE EsDeOficina = 1
          GROUP BY Servicio
      )
      SELECT 
          (SELECT Served + Abandoned FROM GlobalGeneral) AS Global_TotalTurnos,
          (SELECT Served FROM GlobalGeneral) AS Global_Atendidos,
          (SELECT Abandoned FROM GlobalGeneral) AS Global_Abandonados,
          (SELECT AvgWait FROM GlobalGeneral) AS Global_AvgEsperaSeg,
          (SELECT AvgService FROM GlobalGeneral) AS Global_AvgAtencionSeg,
          (SELECT Global_AvgWaitingTimeWarning FROM GlobalGeneral) AS Global_AvgWaitingTimeWarning,
          (SELECT Global_AvgWaitingTimeCritical FROM GlobalGeneral) AS Global_AvgWaitingTimeCritical,
          (SELECT Global_AvgServiceTimeWarning FROM GlobalGeneral) AS Global_AvgServiceTimeWarning,
          (SELECT Global_AvgServiceTimeCritical FROM GlobalGeneral) AS Global_AvgServiceTimeCritical,
          (SELECT ROUND(SAFE_DIVIDE(WaitWithinGoal, TotalWaiting) * 100, 2) FROM GlobalGeneral) AS Global_PorcentajeEsperaEnObjetivo,
 
          (SELECT Served + Abandoned FROM GlobalOficina) AS GlobalOficina_TotalTurnos,
          (SELECT Served FROM GlobalOficina) AS GlobalOficina_Atendidos,
          (SELECT Abandoned FROM GlobalOficina) AS GlobalOficina_Abandonados,
          (SELECT AvgWait FROM GlobalOficina) AS GlobalOficina_AvgEsperaSeg,
          (SELECT AvgService FROM GlobalOficina) AS GlobalOficina_AvgAtencionSeg,
          (SELECT AvgWaitingTimeWarning FROM GlobalOficina) AS Oficina_AvgWaitingTimeWarning,
          (SELECT AvgWaitingTimeCritical FROM GlobalOficina) AS Oficina_AvgWaitingTimeCritical,
          (SELECT AvgServiceTimeWarning FROM GlobalOficina) AS Oficina_AvgServiceTimeWarning,
          (SELECT AvgServiceTimeCritical FROM GlobalOficina) AS Oficina_AvgServiceTimeCritical,
          (SELECT ROUND(SAFE_DIVIDE(WaitWithinGoal, TotalWaiting) * 100, 2) FROM GlobalOficina) AS Oficina_PorcentajeEsperaEnObjetivo,
 
          ms.Served + ms.Abandoned AS TotalTurnosPorServicio,
          ms.Served AS AtendidosPorServicio,
          ms.Abandoned AS AbandonadosPorServicio,
          ms.AvgWait AS AvgEsperaSeg_Servicio,
          ms.AvgService AS AvgAtencionSeg_Servicio,
          ROUND(SAFE_DIVIDE(ms.WaitWithinGoal, ms.TotalWaiting) * 100, 2) AS Servicio_PorcentajeEsperaEnObjetivo,
          ms.WaitingTimeWarning,
          ms.WaitingTimeCritical,
          ms.ServiceTimeWarning,
          ms.ServiceTimeCritical,
 
          -- Counters
          obs.Oficinas_Espera_Critical,
          obs.Oficinas_Espera_Warning,
          obs.Oficinas_Servicio_Critical,
          obs.Oficinas_Servicio_Warning,
          obs.Total_Oficinas,
          sbs.Servicios_Espera_Critical,
          sbs.Servicios_Espera_Warning,
          sbs.Servicios_Servicio_Critical,
          sbs.Servicios_Servicio_Warning,
          sbs.Total_Servicios,
          obss.Oficinas_Espera_Critical AS OficinasByService_Espera_Critical,
          obss.Oficinas_Espera_Warning AS OficinasByService_Espera_Warning,
          obss.Oficinas_Servicio_Critical AS OficinasByService_Servicio_Critical,
          obss.Oficinas_Servicio_Warning AS OficinasByService_Servicio_Warning,
          obss.Total_Oficinas AS OficinasByService_Total,
 
          -- Rankings
           ARRAY(SELECT AS STRUCT Oficina, AvgEspera, AvgServicio, PorcentajeEnObjetivo, WaitingTimeStandard, WaitingTimeCritical, WaitingTimeWarning, ServiceTimeCritical, ServiceTimeWarning FROM RankingsUnidades WHERE AvgEspera IS NOT NULL ORDER BY AvgEspera DESC) AS Top_Unidades_Espera,
          ARRAY(SELECT AS STRUCT Oficina, AvgEspera, AvgServicio, PorcentajeEnObjetivo, WaitingTimeStandard, WaitingTimeCritical, WaitingTimeWarning, ServiceTimeCritical, ServiceTimeWarning FROM RankingsUnidades WHERE AvgServicio IS NOT NULL ORDER BY AvgServicio DESC) AS Top_Unidades_Servicio,
          ARRAY(SELECT AS STRUCT Oficina, TotalVolumen, PorcentajeEnObjetivo FROM RankingsUnidades ORDER BY TotalVolumen DESC) AS Top_Unidades_Volumen,
          ARRAY(SELECT AS STRUCT Oficina, TotalAbandonos, PorcentajeEnObjetivo FROM RankingsUnidades ORDER BY TotalAbandonos DESC) AS Top_Unidades_Abandonos,
          
          ARRAY(SELECT AS STRUCT Servicio, AvgEspera, PorcentajeEnObjetivo, WaitingTimeStandard, WaitingTimeCritical, WaitingTimeWarning, ServiceTimeCritical, ServiceTimeWarning FROM RankingsServicios WHERE AvgEspera IS NOT NULL ORDER BY AvgEspera DESC) AS Top_Servicios_Espera,
          ARRAY(SELECT AS STRUCT Servicio, AvgServicio, PorcentajeEnObjetivo, WaitingTimeStandard, WaitingTimeCritical, WaitingTimeWarning, ServiceTimeCritical, ServiceTimeWarning FROM RankingsServicios WHERE AvgServicio IS NOT NULL ORDER BY AvgServicio DESC) AS Top_Servicios_Servicio,
          ARRAY(SELECT AS STRUCT Servicio, TotalVolumen, PorcentajeEnObjetivo FROM RankingsServicios ORDER BY TotalVolumen DESC) AS Top_Servicios_Volumen,
          ARRAY(SELECT AS STRUCT Servicio, TotalAbandonos, PorcentajeEnObjetivo FROM RankingsServicios ORDER BY TotalAbandonos DESC) AS Top_Servicios_Abandonos
      FROM (SELECT 1) AS dummy_row
      LEFT JOIN MetricasServicio ms ON 1=1
      CROSS JOIN OficinasByStatus obs
      CROSS JOIN ServiciosByStatus sbs
      CROSS JOIN OficinasByServiceStatus obss
      LIMIT 1
    `;

    const supervisorQuery = `
      SELECT 
        SUM(CurrentlyWaiting) as CurrentlyWaiting,
        SUM(CurrentlyInService) as CurrentlyInService,
        MAX(MaxWaitingTime) as MaxWaitingTime,
        MAX(MaxServiceTime) as MaxServiceTime,
        SUM(AgentsSignedIn) as AgentsSignedIn,
        SUM(AgentsIdle) as AgentsIdle,
        SUM(AgentsInBackOffice) as AgentsInBackOffice,
        SUM(AgentsInService) as AgentsInService,
        SUM(AgentsInReception) as AgentsInReception
      FROM \`master-reactor-476520-p0.Dislive.UnitSupervisorDashboardRegional\`
      WHERE ${unit ? `UnitName LIKE '${unit}%'` : '1=1'}
    `;

    const supervisorByUnitQuery = `
      SELECT
        UnitName,
        SUM(COALESCE(CurrentlyWaiting, 0)) as CurrentlyWaiting,
        MAX(MaxWaitingTime) as MaxWaitingTime,
        MAX(MaxServiceTime) as MaxServiceTime,
        SUM(COALESCE(AgentsSignedIn, 0)) as AgentsSignedIn,
        SUM(COALESCE(AgentsInService, 0)) as AgentsInService,
        SUM(COALESCE(AgentsIdle, 0)) as AgentsIdle,
        SUM(COALESCE(AgentsInBackOffice, 0)) as AgentsInBackOffice,
        SUM(COALESCE(AgentsInReception, 0)) as AgentsInReception
      FROM \`master-reactor-476520-p0.Dislive.UnitSupervisorDashboardRegional\`
      WHERE ${unit ? `UPPER(UnitName) LIKE UPPER('${unit}%')` : '1=1'}
      GROUP BY UnitName
      HAVING CurrentlyWaiting > 0 OR AgentsSignedIn > 0
      ORDER BY CurrentlyWaiting DESC
    `;

    console.log(`[Live-Data] Fetching globals. Unit: ${unit || 'All'}`);

    const [detailResults, globalsResult, supervisorResult, supervisorByUnitResult] = await Promise.all([
      bigquery.query({ query: detailQuery, location: 'southamerica-west1' }),
      bigquery.query({ query: globalsQuery, location: 'southamerica-west1' }),
      bigquery.query({ query: supervisorQuery, location: 'southamerica-west1' }),
      bigquery.query({ query: supervisorByUnitQuery, location: 'southamerica-west1' })
    ]);

    const waitingByUnit = (supervisorByUnitResult && supervisorByUnitResult[0]) ? supervisorByUnitResult[0] : [];
    console.log(`[Live-Data] WaitingByUnit rows: ${waitingByUnit.length}`);

    const finalGlobals = {
      ...(globalsResult && globalsResult[0] && globalsResult[0][0] ? globalsResult[0][0] : {}),
      ...(supervisorResult && supervisorResult[0] && supervisorResult[0][0] ? supervisorResult[0][0] : {}),
      WaitingByUnit: waitingByUnit
    };

    res.json({
      data: detailResults[0],
      globals: finalGlobals
    });
  } catch (error) {
    console.error('Error in live-data query:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to get filter options for live data (units and services)
app.get('/api/live-data/options', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const unitQuery = `
      SELECT DISTINCT Oficina 
      FROM \`master-reactor-476520-p0.Dislive.Turnos_Detalle\`
      WHERE DATE(StartDate) = '${targetDate}'
        AND Oficina IS NOT NULL
      ORDER BY Oficina
    `;

    const serviceQuery = `
      SELECT DISTINCT ServiceName AS Servicio 
      FROM \`master-reactor-476520-p0.Dislive.Turnos_Detalle\`
      WHERE DATE(StartDate) = '${targetDate}'
        AND ServiceName IS NOT NULL
      ORDER BY Servicio
    `;

    const [unitRows] = await bigquery.query({ query: unitQuery, location: 'southamerica-west1' });
    const [serviceRows] = await bigquery.query({ query: serviceQuery, location: 'southamerica-west1' });

    res.json({
      units: unitRows.map(r => r.Oficina),
      services: serviceRows.map(r => r.Servicio)
    });
  } catch (error) {
    console.error('Error fetching live data options:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projections/options', async (req, res) => {
  try {
    const unitQuery = `SELECT DISTINCT unidad_id, nombre_unidad FROM \`master-reactor-476520-p0.Dislive.v_dashboard_plan_2026\` ORDER BY nombre_unidad`;
    const serviceQuery = `SELECT DISTINCT servicio FROM \`master-reactor-476520-p0.Dislive.v_dashboard_plan_2026\` ORDER BY servicio`;
    const dateQuery = `SELECT DISTINCT DATE(fecha_proyeccion) as fecha FROM \`master-reactor-476520-p0.Dislive.v_dashboard_plan_2026\` ORDER BY fecha DESC`;

    const [unitRows] = await bigquery.query(unitQuery);
    const [serviceRows] = await bigquery.query(serviceQuery);
    const [dateRows] = await bigquery.query(dateQuery);

    res.json({
      units: unitRows.map(r => ({ id: r.unidad_id, name: r.nombre_unidad })),
      services: serviceRows.map(r => r.servicio),
      dates: dateRows.map(r => r.fecha.value || r.fecha)
    });
  } catch (error) {
    console.error('Error fetching projection options:', error);
    res.status(500).json({ error: error.message });
  }
});

function timeToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.length !== 3) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function secondsToTime(seconds) {
  if (!seconds || seconds <= 0) return "00:00:00";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

app.post('/api/ai-chat', async (req, res) => {
  try {
    const { message, history, context } = req.body;

    const systemPrompt = `Eres un asistente inteligente llamado "Asistente de Datos en Vivo" experto en análisis de datos de turnos y atención al cliente. Estás embebido en un dashboard en vivo.
Tu trabajo es responder las preguntas del supervisor analizando el siguiente contexto de datos en tiempo real (JSON):

CONTEXTO ACTUAL:
${JSON.stringify(context, null, 2)}

CONOCIMIENTO DE TABLAS:
Tienes acceso a los datos de la tabla \`UnitSupervisorDashboardRegional_Agents\` que contiene el estado en tiempo real de cada agente.
Estructura de la tabla:
- UserId (INTEGER): identificador único del agente
- FullName (STRING): nombre completo del agente
- UnitId (FLOAT): identificador de la unidad a la que pertenece el agente
- FunctionName (STRING): función o cola asignada al agente (ej. General, Preferencial, Turno Inteligente)
- AgentState (STRING): estado actual del agente. Valores posibles:
  * "LoggedIn" = Conectado (logueado pero sin atender)
  * "LoggedOut" = Desconectado
  * "InService" = En Atención (atendiendo un turno actualmente)
  * "Idle" = Inactivo (conectado pero sin turno)
  * "BackOffice" = En Backoffice
  * "Reception" = En Recepción

En el contexto "AGENTES_POR_UNIDAD" encontrarás los conteos por unidad y por estado ya calculados.
Si el usuario cargó el detalle de una unidad específica, encontrarás los datos individuales en "AGENTES_DETALLE_UNIDAD".

Reglas:
1. Sé extremadamente conciso, directo al punto y amable.
2. Usa lenguaje claro y directo. Saluda si es el primer mensaje.
3. Formatea tu respuesta usando Markdown (negritas para métricas clave o unidades importantes).
4. El término "AgentsIdle" en los datos significa "Agentes Inactivos". No uses la palabra "Disponibles", usa siempre "Inactivos".
5. Si te preguntan algo fuera de los datos de este dashboard de monitoreo en vivo, di que solo tienes acceso a la visión actual.
5. NO inventes datos. Usa únicamente el JSON provisto arriba.
6. MUY IMPORTANTE: Si vas a mostrar tiempos de espera o duraciones que vengan en segundos, SIEMPRE repórtalos utilizando formato de reloj HH:MM:SS (ej. 01:25:31) en lugar de dar la cantidad cruda de segundos.
`;

    const chatHistory = (history || []).map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // Añadir el mensaje actual del usuario
    chatHistory.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: chatHistory,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2, // Temperatura baja para respuestas factuales
      }
    });

    res.json({ reply: response.text });
  } catch (error) {
    console.error('Error in AI Chat:', error);
    res.status(500).json({ error: 'Hubo un error procesando tu solicitud de chat.' });
  }
});


// ==================== AUTH SYSTEM ====================
const JWT_SECRET = process.env.JWT_SECRET || 'issat_dashboard_secret_2024_!@#$';
const DATASET = 'Dislive';
const USERS_TABLE = `master-reactor-476520-p0.${DATASET}.usuarios`;

// Middleware: validates JWT and optionally checks role
function requireAuth(requiredRole) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      if (requiredRole && decoded.rol !== requiredRole) {
        return res.status(403).json({ error: 'No tienes permisos para esta acción' });
      }
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };
}

// Create users table if not exists and seed first admin
async function initUsersTable() {
  try {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS \`${USERS_TABLE}\` (
        id STRING NOT NULL,
        username STRING NOT NULL,
        password_hash STRING NOT NULL,
        nombre STRING,
        rol STRING NOT NULL,
        activo BOOL NOT NULL,
        created_at TIMESTAMP NOT NULL
      )
    `;
    await bigquery.query({ query: createTableSQL });
    console.log('✅ Tabla usuarios lista en BigQuery.');

    // Check if any user exists
    const [rows] = await bigquery.query({ query: `SELECT COUNT(*) as cnt FROM \`${USERS_TABLE}\`` });
    const count = parseInt(rows[0]?.cnt?.value ?? rows[0]?.cnt ?? '0');
    if (count === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      const uid = `usr_${Date.now()}`;
      await bigquery.query({
        query: `INSERT INTO \`${USERS_TABLE}\` (id, username, password_hash, nombre, rol, activo, created_at) VALUES (@id, @username, @password_hash, @nombre, @rol, TRUE, CURRENT_TIMESTAMP())`,
        params: { id: uid, username: 'admin', password_hash: hash, nombre: 'Administrador', rol: 'admin' }
      });
      console.log('✅ Usuario admin creado por defecto (admin / admin123)');
    }
  } catch (err) {
    console.error('❌ Error inicializando tabla usuarios:', err.message);
  }
}

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  try {
    const [rows] = await bigquery.query({
      query: `SELECT * FROM \`${USERS_TABLE}\` WHERE username = @username AND activo = TRUE LIMIT 1`,
      params: { username }
    });
    if (rows.length === 0) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const token = jwt.sign({ userId: user.id, username: user.username, rol: user.rol, nombre: user.nombre }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { userId: user.id, username: user.username, rol: user.rol, nombre: user.nombre } });
  } catch (err) {
    console.error('Error in /api/auth/login:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/auth/verify
app.get('/api/auth/verify', requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

// GET /api/admin/users — list all users (admin only)
app.get('/api/admin/users', requireAuth('admin'), async (req, res) => {
  try {
    const [rows] = await bigquery.query({ query: `SELECT id, username, nombre, rol, activo, FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', created_at) as created_at FROM \`${USERS_TABLE}\` ORDER BY created_at DESC` });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users — create user (admin only)
app.post('/api/admin/users', requireAuth('admin'), async (req, res) => {
  const { username, password, nombre, rol } = req.body;
  if (!username || !password || !rol) return res.status(400).json({ error: 'Faltan campos requeridos' });
  try {
    // Check duplicate
    const [existing] = await bigquery.query({ query: `SELECT id FROM \`${USERS_TABLE}\` WHERE username = @username LIMIT 1`, params: { username } });
    if (existing.length > 0) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    const hash = await bcrypt.hash(password, 10);
    const uid = `usr_${Date.now()}`;
    await bigquery.query({
      query: `INSERT INTO \`${USERS_TABLE}\` (id, username, password_hash, nombre, rol, activo, created_at) VALUES (@id, @username, @password_hash, @nombre, @rol, TRUE, CURRENT_TIMESTAMP())`,
      params: { id: uid, username, password_hash: hash, nombre: nombre || username, rol }
    });
    res.json({ success: true, id: uid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id — edit user (admin only)
app.put('/api/admin/users/:id', requireAuth('admin'), async (req, res) => {
  const { id } = req.params;
  const { nombre, rol, activo, password } = req.body;
  try {
    let setClauses = [];
    let params = { id };
    if (nombre !== undefined) { setClauses.push('nombre = @nombre'); params.nombre = nombre; }
    if (rol !== undefined) { setClauses.push('rol = @rol'); params.rol = rol; }
    if (activo !== undefined) { setClauses.push('activo = @activo'); params.activo = Boolean(activo); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      setClauses.push('password_hash = @password_hash');
      params.password_hash = hash;
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    await bigquery.query({ query: `UPDATE \`${USERS_TABLE}\` SET ${setClauses.join(', ')} WHERE id = @id`, params });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id — delete user (admin only)
app.delete('/api/admin/users/:id', requireAuth('admin'), async (req, res) => {
  const { id } = req.params;
  // Prevent deleting yourself
  if (id === req.user.userId) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  try {
    await bigquery.query({ query: `DELETE FROM \`${USERS_TABLE}\` WHERE id = @id`, params: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==================== END AUTH SYSTEM ====================

// Ruta comodín para manejar el routing de React (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, async () => {
  console.log(`Backend server running at http://localhost:${port}`);
  await initUsersTable();
});
