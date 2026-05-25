import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-development';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const distPath = path.join(__dirname, 'dist');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://dashboard:dashboard@localhost:5432/livedata_dashboard',
});

app.use(cors());
app.use(express.json());
app.use(express.static(distPath));

const pad = (value) => String(value).padStart(2, '0');
const secondsToClock = (seconds) => {
  const safe = Math.max(0, Math.round(seconds || 0));
  return `${pad(Math.floor(safe / 3600))}:${pad(Math.floor((safe % 3600) / 60))}:${pad(safe % 60)}`;
};

const units = [
  { id: 9101, name: 'Bogota', agents: 42 },
  { id: 9102, name: 'Medellin', agents: 36 },
  { id: 9103, name: 'Cali', agents: 33 },
  { id: 9104, name: 'Barranquilla', agents: 29 },
  { id: 9105, name: 'Bucaramanga', agents: 24 },
  { id: 9106, name: 'Pereira', agents: 21 },
];

const services = [
  { id: 8101, name: 'Atencion general' },
  { id: 8102, name: 'Caja' },
  { id: 8103, name: 'Soporte' },
  { id: 8104, name: 'Radicacion' },
];

const todayBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const toTimestamp = (date, hour, minute, second = 0) => `${date} ${pad(hour)}:${pad(minute)}:${pad(second)}-05`;
const randomBetween = (min, max) => min + Math.random() * (max - min);

let syntheticRefreshPromise = null;
let lastSyntheticRefreshAt = 0;

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT,
      rol TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active TIMESTAMPTZ,
      session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS turnos_detalle (
      process_id BIGINT NOT NULL,
      service_id INTEGER NOT NULL,
      service_name TEXT NOT NULL,
      oficina TEXT NOT NULL,
      resolution TEXT NOT NULL DEFAULT '0',
      entity_status INTEGER NOT NULL,
      duration INTEGER,
      start_date TIMESTAMPTZ NOT NULL,
      waiting_time_standard INTEGER,
      waiting_time_warning INTEGER,
      waiting_time_critical INTEGER,
      service_time_warning INTEGER,
      service_time_critical INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos_detalle (start_date);
    CREATE INDEX IF NOT EXISTS idx_turnos_oficina ON turnos_detalle (oficina);

    CREATE TABLE IF NOT EXISTS unit_service_regionalp (
      service_id INTEGER NOT NULL,
      service_name TEXT NOT NULL,
      unit_id INTEGER NOT NULL,
      unit_name TEXT NOT NULL,
      start_date TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unit_supervisor_dashboard_regional (
      unit_name TEXT PRIMARY KEY,
      currently_waiting INTEGER NOT NULL,
      currently_in_service INTEGER NOT NULL,
      max_waiting_time TEXT NOT NULL,
      max_service_time TEXT NOT NULL,
      agents_signed_in INTEGER NOT NULL,
      agents_idle INTEGER NOT NULL,
      agents_in_backoffice INTEGER NOT NULL,
      agents_in_service INTEGER NOT NULL,
      agents_in_reception INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unit_supervisor_dashboard_regional_agents (
      user_id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      function_name TEXT NOT NULL,
      agent_state TEXT NOT NULL,
      unit_id INTEGER NOT NULL
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM usuarios');
  if (rows[0].count === 0) {
    await pool.query(
      `INSERT INTO usuarios (id, username, password_hash, nombre, rol, activo)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [`usr_${Date.now()}`, 'admin', await bcrypt.hash('admin123', 10), 'Administrador', 'admin'],
    );
  }
}

async function seedDemoData(date = todayBogota()) {
  const unitNames = units.map((unit) => unit.name);
  const unitIds = units.map((unit) => unit.id);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM turnos_detalle WHERE start_date::date = $1 AND oficina = ANY($2)', [date, unitNames]);
    await client.query('DELETE FROM unit_service_regionalp WHERE start_date::date = $1 AND unit_id = ANY($2)', [date, unitIds]);
    await client.query('DELETE FROM unit_supervisor_dashboard_regional WHERE unit_name = ANY($1)', [unitNames]);
    await client.query('DELETE FROM unit_supervisor_dashboard_regional_agents WHERE unit_id = ANY($1)', [unitIds]);

    let processId = Number(`${date.replaceAll('-', '')}0000`);
    for (let hour = 8; hour <= 17; hour++) {
      for (const minute of [0, 15, 30, 45]) {
        const peak = hour >= 10 && hour <= 12 ? 1.45 : hour >= 15 && hour <= 16 ? 1.25 : 0.9;
        const wave = 1 + Math.sin((hour * 60 + minute) / 37) * 0.18;

        for (const unit of units) {
          for (const service of services) {
            await client.query(
              `INSERT INTO unit_service_regionalp (service_id, service_name, unit_id, unit_name, start_date)
               VALUES ($1, $2, $3, $4, $5)`,
              [service.id, service.name, unit.id, unit.name, toTimestamp(date, hour, minute)],
            );

            const baseTurns = service.id === 8101 ? 5 : service.id === 8102 ? 4 : service.id === 8103 ? 3 : 2;
            const liveJitter = randomBetween(0.82, 1.2);
            const turns = Math.max(1, Math.round(baseTurns * peak * wave * liveJitter));

            for (let i = 0; i < turns; i++) {
              processId += 1;
              const waitDuration = Math.max(45, Math.round(210 + peak * 145 + ((i + unit.id + service.id) % 7) * 28 + randomBetween(-45, 55)));
              const serviceDuration = Math.max(60, Math.round(280 + peak * 80 + ((i + hour) % 5) * 35 + randomBetween(-35, 65)));
              const abandoned = Math.random() < randomBetween(0.045, 0.08);
              const startSecond = (i * 7) % 60;
              const common = [
                processId,
                service.id,
                service.name,
                unit.name,
                '0',
                420,
                600,
                900,
                480,
                720,
              ];

              await client.query(
                `INSERT INTO turnos_detalle
                 (process_id, service_id, service_name, oficina, resolution, entity_status, duration, start_date,
                  waiting_time_standard, waiting_time_warning, waiting_time_critical, service_time_warning, service_time_critical)
                 VALUES ($1,$2,$3,$4,$5,3,$6,$7,$8,$9,$10,$11,$12)`,
                [...common.slice(0, 5), waitDuration, toTimestamp(date, hour, minute, startSecond), ...common.slice(5)],
              );

              await client.query(
                `INSERT INTO turnos_detalle
                 (process_id, service_id, service_name, oficina, resolution, entity_status, duration, start_date,
                  waiting_time_standard, waiting_time_warning, waiting_time_critical, service_time_warning, service_time_critical)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [
                  ...common.slice(0, 5),
                  abandoned ? 4 : 6,
                  abandoned ? waitDuration : serviceDuration,
                  toTimestamp(date, hour, minute, Math.min(59, startSecond + 4)),
                  ...common.slice(5),
                ],
              );
            }
          }
        }
      }
    }

    for (const [index, unit] of units.entries()) {
      await client.query(
        `INSERT INTO unit_supervisor_dashboard_regional
         (unit_name, currently_waiting, currently_in_service, max_waiting_time, max_service_time,
          agents_signed_in, agents_idle, agents_in_backoffice, agents_in_service, agents_in_reception)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          unit.name,
          Math.max(1, 18 - index * 4 + Math.round(randomBetween(-3, 5))),
          Math.max(1, unit.agents - 8 + Math.round(randomBetween(-2, 3))),
          secondsToClock(780 - index * 75 + Math.round(randomBetween(-70, 95))),
          secondsToClock(610 - index * 45 + Math.round(randomBetween(-45, 75))),
          unit.agents,
          Math.max(0, 5 + index + Math.round(randomBetween(-2, 3))),
          Math.max(0, 2 + index + Math.round(randomBetween(-1, 2))),
          Math.max(1, unit.agents - 8 + Math.round(randomBetween(-2, 3))),
          Math.max(0, (index === 0 ? 2 : 1) + Math.round(randomBetween(0, 2))),
        ],
      );

      const states = ['InService', 'Idle', 'BackOffice', 'Reception'];
      for (let i = 1; i <= unit.agents; i++) {
        await client.query(
          `INSERT INTO unit_supervisor_dashboard_regional_agents
           (user_id, full_name, function_name, agent_state, unit_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            unit.id * 1000 + i,
            `Agente ${unit.name} ${pad(i)}`,
            i % 3 === 0 ? 'Asesor especializado' : 'Asesor servicio',
            states[i % states.length],
            unit.id,
          ],
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureDemoDataForDate(date = todayBogota(), options = {}) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM turnos_detalle WHERE start_date::date = $1',
    [date],
  );

  if (rows[0].count === 0) {
    console.log(`No demo data found for ${date}; generating synthetic LiveData rows.`);
    await seedDemoData(date);
    lastSyntheticRefreshAt = Date.now();
    return;
  }

  const shouldRefresh = options.refresh === true
    && process.env.LIVE_DEMO_REFRESH !== 'false'
    && date === todayBogota()
    && Date.now() - lastSyntheticRefreshAt >= 60000;

  if (shouldRefresh) {
    if (!syntheticRefreshPromise) {
      syntheticRefreshPromise = seedDemoData(date)
        .then(() => {
          lastSyntheticRefreshAt = Date.now();
        })
        .finally(() => {
          syntheticRefreshPromise = null;
        });
    }
    await syntheticRefreshPromise;
  }
}

function requireAuth(requiredRole) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const { rows } = await pool.query('SELECT session_id FROM usuarios WHERE id = $1 AND activo = TRUE', [decoded.userId]);
      if (!rows.length || rows[0].session_id !== decoded.sessionId) {
        return res.status(401).json({ error: 'SESSION_INVALIDATED' });
      }
      if (requiredRole && decoded.rol !== requiredRole) {
        return res.status(403).json({ error: 'No tienes permisos para esta accion' });
      }
      req.user = decoded;
      await pool.query('UPDATE usuarios SET last_active = NOW() WHERE id = $1', [decoded.userId]);
      next();
    } catch {
      res.status(401).json({ error: 'Token invalido' });
    }
  };
}

app.post('/api/auth/login', async (req, res) => {
  const { username, password, force } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const { rows } = await pool.query(
    `SELECT *, (last_active > NOW() - INTERVAL '5 minutes') AS is_online
     FROM usuarios WHERE username = $1 AND activo = TRUE LIMIT 1`,
    [username],
  );

  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const user = rows[0];
  if (user.is_online && user.session_id && !force) {
    return res.status(409).json({
      error: 'ALREADY_LOGGED_IN',
      message: 'Ya tienes una sesion activa en otro dispositivo. Deseas cerrarla e ingresar aqui?',
    });
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  await pool.query('UPDATE usuarios SET last_active = NOW(), session_id = $1 WHERE id = $2', [sessionId, user.id]);

  const token = jwt.sign({
    userId: user.id,
    username: user.username,
    rol: user.rol,
    nombre: user.nombre,
    sessionId,
  }, JWT_SECRET, { expiresIn: '8h' });

  res.json({ token, user: { userId: user.id, username: user.username, rol: user.rol, nombre: user.nombre } });
});

app.get('/api/auth/verify', requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/admin/users', requireAuth('admin'), async (_req, res) => {
  const { rows } = await pool.query('SELECT id, username, nombre, rol, activo, created_at FROM usuarios ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/admin/users', requireAuth('admin'), async (req, res) => {
  const { username, password, nombre, rol } = req.body;
  if (!username || !password || !rol) return res.status(400).json({ error: 'Faltan campos requeridos' });

  try {
    const id = `usr_${Date.now()}`;
    await pool.query(
      `INSERT INTO usuarios (id, username, password_hash, nombre, rol, activo)
       VALUES ($1,$2,$3,$4,$5,TRUE)`,
      [id, username, await bcrypt.hash(password, 10), nombre || username, rol],
    );
    res.json({ success: true, id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/admin/users/:id', requireAuth('admin'), async (req, res) => {
  const { id } = req.params;
  const { nombre, rol, activo, password } = req.body;
  const hash = password ? await bcrypt.hash(password, 10) : null;
  await pool.query(
    `UPDATE usuarios
     SET nombre = COALESCE($2, nombre),
         rol = COALESCE($3, rol),
         activo = COALESCE($4, activo),
         password_hash = COALESCE($5, password_hash)
     WHERE id = $1`,
    [id, nombre, rol, activeToNull(activo), hash],
  );
  res.json({ success: true });
});

function activeToNull(value) {
  return typeof value === 'boolean' ? value : null;
}

app.delete('/api/admin/users/:id', requireAuth('admin'), async (req, res) => {
  if (req.params.id === req.user.userId) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/live-data/options', requireAuth(), async (req, res) => {
  const targetDate = req.query.date || todayBogota();
  await ensureDemoDataForDate(targetDate);
  const [unitsResult, servicesResult] = await Promise.all([
    pool.query('SELECT DISTINCT oficina FROM turnos_detalle WHERE start_date::date = $1 ORDER BY oficina', [targetDate]),
    pool.query('SELECT DISTINCT service_name FROM turnos_detalle WHERE start_date::date = $1 ORDER BY service_name', [targetDate]),
  ]);

  res.json({
    units: unitsResult.rows.map((row) => row.oficina),
    services: servicesResult.rows.map((row) => row.service_name),
  });
});

app.get('/api/live-data', requireAuth(), async (req, res) => {
  const { unit, service, granularity = 'hour' } = req.query;
  const targetDate = req.query.date || todayBogota();
  await ensureDemoDataForDate(targetDate, { refresh: true });
  const trunc = granularity === 'minute' ? 'minute' : 'hour';
  const timeFormat = granularity === 'minute' ? 'HH24:MI' : 'HH24:00';
  const params = [targetDate];
  let where = `start_date::date = $1 AND entity_status NOT IN (40,41) AND resolution <> '4'`;
  if (unit) {
    params.push(`${unit}%`);
    where += ` AND oficina ILIKE $${params.length}`;
  }
  if (service) {
    params.push(`${service}%`);
    where += ` AND service_name ILIKE $${params.length}`;
  }

  const detailQuery = `
    WITH clean AS (
      SELECT process_id, service_id, service_name, oficina, resolution,
             CASE WHEN entity_status IN (3,11) THEN 3 ELSE entity_status END AS entity_status,
             SUM(duration) AS duration,
             MIN(start_date) AS start_date
      FROM turnos_detalle
      WHERE ${where}
      GROUP BY process_id, service_id, service_name, oficina, resolution,
               CASE WHEN entity_status IN (3,11) THEN 3 ELSE entity_status END
    )
    SELECT TO_CHAR(DATE_TRUNC('${trunc}', start_date), '${timeFormat}') AS "Hora_Minuto",
           SUM(CASE WHEN entity_status = 6 AND duration IS NOT NULL THEN 1 ELSE 0 END)::int AS "Atendidos",
           SUM(CASE WHEN entity_status = 4 THEN 1 ELSE 0 END)::int AS "Abandonos",
           SUM(CASE WHEN entity_status = 3 AND duration IS NOT NULL THEN 1 ELSE 0 END)::int AS "TurnosConEspera",
           AVG(CASE WHEN entity_status = 3 AND duration IS NOT NULL AND resolution <> '3' THEN duration END)::float AS "Segundos_Espera",
           AVG(CASE WHEN entity_status = 6 AND duration IS NOT NULL THEN duration END)::float AS "Segundos_Servicio",
           (SUM(CASE WHEN entity_status = 6 AND duration IS NOT NULL THEN 1 ELSE 0 END)
            + SUM(CASE WHEN entity_status = 4 THEN 1 ELSE 0 END))::int AS "Total_Turnos"
    FROM clean
    GROUP BY 1
    ORDER BY 1
  `;

  const { rows: data } = await pool.query(detailQuery, params);
  const { rows: rawRows } = await pool.query(`SELECT * FROM turnos_detalle WHERE ${where}`, params);
  const globals = await buildGlobals(rawRows, unit);
  res.json({ data, globals });
});

async function buildGlobals(rows, unit) {
  const clean = rows.filter((row) => row.entity_status !== 40 && row.entity_status !== 41 && row.resolution !== '4');
  const served = clean.filter((row) => row.entity_status === 6);
  const abandoned = clean.filter((row) => row.entity_status === 4);
  const waits = clean.filter((row) => [3, 11].includes(row.entity_status) && row.resolution !== '3');
  const avg = (items) => items.length ? items.reduce((sum, item) => sum + Number(item.duration || 0), 0) / items.length : 0;
  const avgWait = avg(waits);
  const avgService = avg(served);
  const waitingWarning = avgValue(clean, 'waiting_time_warning') || 600;
  const waitingCritical = avgValue(clean, 'waiting_time_critical') || 900;
  const serviceWarning = avgValue(clean, 'service_time_warning') || 480;
  const serviceCritical = avgValue(clean, 'service_time_critical') || 720;
  const waitWithinGoal = waits.filter((row) => Number(row.duration || 0) <= Number(row.waiting_time_standard || 420)).length;

  const supParams = unit ? [`${unit}%`] : [];
  const supWhere = unit ? 'WHERE unit_name ILIKE $1' : '';
  const { rows: supervisorRows } = await pool.query(`SELECT * FROM unit_supervisor_dashboard_regional ${supWhere}`, supParams);

  const waitingByUnit = supervisorRows
    .filter((row) => Number(row.currently_waiting) > 0 || Number(row.agents_signed_in) > 0)
    .map((row) => ({
      UnitName: row.unit_name,
      CurrentlyWaiting: Number(row.currently_waiting),
      MaxWaitingTime: row.max_waiting_time,
      MaxServiceTime: row.max_service_time,
      AgentsSignedIn: Number(row.agents_signed_in),
      AgentsInService: Number(row.agents_in_service),
      AgentsIdle: Number(row.agents_idle),
      AgentsInBackOffice: Number(row.agents_in_backoffice),
      AgentsInReception: Number(row.agents_in_reception),
    }));
  const rankings = buildRankings(clean);

  return {
    Global_TotalTurnos: served.length + abandoned.length,
    Global_Atendidos: served.length,
    Global_Abandonados: abandoned.length,
    Global_AvgEsperaSeg: avgWait,
    Global_AvgAtencionSeg: avgService,
    Global_AvgWaitingTimeWarning: waitingWarning,
    Global_AvgWaitingTimeCritical: waitingCritical,
    Global_AvgServiceTimeWarning: serviceWarning,
    Global_AvgServiceTimeCritical: serviceCritical,
    Global_PorcentajeEsperaEnObjetivo: waits.length ? Math.round((waitWithinGoal / waits.length) * 10000) / 100 : 0,
    CurrentlyWaiting: supervisorRows.reduce((sum, row) => sum + Number(row.currently_waiting || 0), 0),
    CurrentlyInService: supervisorRows.reduce((sum, row) => sum + Number(row.currently_in_service || 0), 0),
    MaxWaitingTime: maxClock(supervisorRows.map((row) => row.max_waiting_time)),
    MaxServiceTime: maxClock(supervisorRows.map((row) => row.max_service_time)),
    AgentsSignedIn: supervisorRows.reduce((sum, row) => sum + Number(row.agents_signed_in || 0), 0),
    AgentsIdle: supervisorRows.reduce((sum, row) => sum + Number(row.agents_idle || 0), 0),
    AgentsInBackOffice: supervisorRows.reduce((sum, row) => sum + Number(row.agents_in_backoffice || 0), 0),
    AgentsInService: supervisorRows.reduce((sum, row) => sum + Number(row.agents_in_service || 0), 0),
    AgentsInReception: supervisorRows.reduce((sum, row) => sum + Number(row.agents_in_reception || 0), 0),
    WaitingByUnit: waitingByUnit,
    ...rankings,
  };
}

function buildRankings(rows) {
  const unitRows = aggregateBy(rows, 'oficina', 'Oficina');
  const serviceRows = aggregateBy(rows, 'service_name', 'Servicio');

  return {
    Top_Unidades_Espera: [...unitRows]
      .filter((row) => row.AvgEspera !== null)
      .sort((a, b) => Number(b.AvgEspera || 0) - Number(a.AvgEspera || 0)),
    Top_Unidades_Servicio: [...unitRows]
      .filter((row) => row.AvgServicio !== null)
      .sort((a, b) => Number(b.AvgServicio || 0) - Number(a.AvgServicio || 0)),
    Top_Unidades_Volumen: [...unitRows].sort((a, b) => Number(b.TotalVolumen || 0) - Number(a.TotalVolumen || 0)),
    Top_Unidades_Abandonos: [...unitRows].sort((a, b) => Number(b.TotalAbandonos || 0) - Number(a.TotalAbandonos || 0)),
    Top_Servicios_Espera: [...serviceRows]
      .filter((row) => row.AvgEspera !== null)
      .sort((a, b) => Number(b.AvgEspera || 0) - Number(a.AvgEspera || 0)),
    Top_Servicios_Servicio: [...serviceRows]
      .filter((row) => row.AvgServicio !== null)
      .sort((a, b) => Number(b.AvgServicio || 0) - Number(a.AvgServicio || 0)),
    Top_Servicios_Volumen: [...serviceRows].sort((a, b) => Number(b.TotalVolumen || 0) - Number(a.TotalVolumen || 0)),
    Top_Servicios_Abandonos: [...serviceRows].sort((a, b) => Number(b.TotalAbandonos || 0) - Number(a.TotalAbandonos || 0)),
    Total_Oficinas: unitRows.length,
    Total_Servicios: serviceRows.length,
    Oficinas_Espera_Critical: countByThreshold(unitRows, 'AvgEspera', 'WaitingTimeCritical'),
    Oficinas_Espera_Warning: countWarning(unitRows, 'AvgEspera', 'WaitingTimeWarning', 'WaitingTimeCritical'),
    Oficinas_Servicio_Critical: countByThreshold(unitRows, 'AvgServicio', 'ServiceTimeCritical'),
    Oficinas_Servicio_Warning: countWarning(unitRows, 'AvgServicio', 'ServiceTimeWarning', 'ServiceTimeCritical'),
    Servicios_Espera_Critical: countByThreshold(serviceRows, 'AvgEspera', 'WaitingTimeCritical'),
    Servicios_Espera_Warning: countWarning(serviceRows, 'AvgEspera', 'WaitingTimeWarning', 'WaitingTimeCritical'),
    Servicios_Servicio_Critical: countByThreshold(serviceRows, 'AvgServicio', 'ServiceTimeCritical'),
    Servicios_Servicio_Warning: countWarning(serviceRows, 'AvgServicio', 'ServiceTimeWarning', 'ServiceTimeCritical'),
  };
}

function aggregateBy(rows, key, outputKey) {
  const groups = new Map();
  for (const row of rows) {
    const name = row[key] || 'Sin nombre';
    if (!groups.has(name)) {
      groups.set(name, {
        [outputKey]: name,
        waitSum: 0,
        waitCount: 0,
        serviceSum: 0,
        serviceCount: 0,
        processIds: new Set(),
        TotalAbandonos: 0,
        waitWithinGoal: 0,
        waitingRows: 0,
        WaitingTimeStandard: 0,
        WaitingTimeWarning: 0,
        WaitingTimeCritical: 0,
        ServiceTimeWarning: 0,
        ServiceTimeCritical: 0,
      });
    }

    const group = groups.get(name);
    group.processIds.add(row.process_id);

    const duration = Number(row.duration || 0);
    if ([3, 11].includes(Number(row.entity_status)) && row.resolution !== '3' && duration > 0) {
      group.waitSum += duration;
      group.waitCount += 1;
      group.waitingRows += 1;
      if (duration <= Number(row.waiting_time_standard || 420)) {
        group.waitWithinGoal += 1;
      }
    }

    if (Number(row.entity_status) === 6 && duration > 0) {
      group.serviceSum += duration;
      group.serviceCount += 1;
    }

    if (Number(row.entity_status) === 4) {
      group.TotalAbandonos += 1;
    }

    group.WaitingTimeStandard = Math.max(group.WaitingTimeStandard, Number(row.waiting_time_standard || 0));
    group.WaitingTimeWarning = Math.max(group.WaitingTimeWarning, Number(row.waiting_time_warning || 0));
    group.WaitingTimeCritical = Math.max(group.WaitingTimeCritical, Number(row.waiting_time_critical || 0));
    group.ServiceTimeWarning = Math.max(group.ServiceTimeWarning, Number(row.service_time_warning || 0));
    group.ServiceTimeCritical = Math.max(group.ServiceTimeCritical, Number(row.service_time_critical || 0));
  }

  return [...groups.values()].map((group) => ({
    [outputKey]: group[outputKey],
    AvgEspera: group.waitCount ? group.waitSum / group.waitCount : null,
    AvgServicio: group.serviceCount ? group.serviceSum / group.serviceCount : null,
    TotalVolumen: group.processIds.size,
    TotalAbandonos: group.TotalAbandonos,
    PorcentajeEnObjetivo: group.waitingRows ? Math.round((group.waitWithinGoal / group.waitingRows) * 10000) / 100 : 0,
    WaitingTimeStandard: group.WaitingTimeStandard,
    WaitingTimeWarning: group.WaitingTimeWarning,
    WaitingTimeCritical: group.WaitingTimeCritical,
    ServiceTimeWarning: group.ServiceTimeWarning,
    ServiceTimeCritical: group.ServiceTimeCritical,
  }));
}

function countByThreshold(rows, valueKey, thresholdKey) {
  return rows.filter((row) => Number(row[thresholdKey] || 0) > 0 && Number(row[valueKey] || 0) >= Number(row[thresholdKey])).length;
}

function countWarning(rows, valueKey, warningKey, criticalKey) {
  return rows.filter((row) => {
    const value = Number(row[valueKey] || 0);
    const warning = Number(row[warningKey] || 0);
    const critical = Number(row[criticalKey] || 0);
    return warning > 0 && value >= warning && (critical === 0 || value < critical);
  }).length;
}

function avgValue(rows, key) {
  const values = rows.map((row) => Number(row[key])).filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clockToSeconds(clock = '00:00:00') {
  const [h = 0, m = 0, s = 0] = String(clock).split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function maxClock(clocks) {
  return secondsToClock(Math.max(0, ...clocks.map(clockToSeconds)));
}

app.get('/api/agents-by-unit', requireAuth(), async (req, res) => {
  const { unitName, agentType } = req.query;
  if (!unitName) return res.status(400).json({ error: 'Missing unitName parameter' });

  const states = {
    AgentsInService: 'InService',
    AgentsIdle: 'Idle',
    AgentsInBackOffice: 'BackOffice',
    AgentsInReception: 'Reception',
  };
  const params = [unitName];
  let stateWhere = "AND a.agent_state <> 'LoggedOut'";
  if (states[agentType]) {
    params.push(states[agentType]);
    stateWhere = `AND a.agent_state = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT a.user_id AS "UserId", a.full_name AS "FullName", a.function_name AS "FunctionName", a.agent_state AS "AgentState"
     FROM unit_supervisor_dashboard_regional_agents a
     WHERE a.unit_id IN (SELECT DISTINCT unit_id FROM unit_service_regionalp WHERE unit_name = $1)
     ${stateWhere}
     ORDER BY a.full_name`,
    params,
  );
  res.json(rows);
});

app.get('/api/all-agents', requireAuth(), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT a.full_name AS "FullName", a.function_name AS "FunctionName", a.agent_state AS "AgentState", u.unit_name AS "UnitName"
     FROM unit_supervisor_dashboard_regional_agents a
     LEFT JOIN (SELECT DISTINCT unit_id, unit_name FROM unit_service_regionalp) u ON a.unit_id = u.unit_id
     WHERE a.agent_state <> 'LoggedOut'
     ORDER BY u.unit_name, a.agent_state, a.full_name`,
  );
  res.json(rows);
});

app.get('/api/waiting-tickets', requireAuth(), async (req, res) => {
  const { unitName } = req.query;
  const targetDate = req.query.date || todayBogota();
  if (!unitName) return res.status(400).json({ error: 'Missing unitName' });
  await ensureDemoDataForDate(targetDate);

  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY process_id ORDER BY start_date DESC) AS rn_last,
              MIN(CASE WHEN entity_status IN (3,11) THEN start_date END) OVER (PARTITION BY process_id) AS wait_start_date
       FROM turnos_detalle
       WHERE start_date::date = $1 AND oficina ILIKE $2 AND entity_status NOT IN (40,41) AND resolution <> '4'
     )
     SELECT process_id AS "ProcessId", service_name AS "ServiceName",
            waiting_time_warning AS "WaitingTimeWarning", waiting_time_critical AS "WaitingTimeCritical",
            TO_CHAR(wait_start_date, 'YYYY-MM-DD"T"HH24:MI:SS') AS "StartDate",
            EXTRACT(EPOCH FROM (NOW() - wait_start_date))::int AS "SecondsWaiting"
     FROM ranked
     WHERE rn_last = 1 AND entity_status IN (3,11)
     ORDER BY wait_start_date`,
    [targetDate, `%${unitName}%`],
  );
  res.json(rows);
});

app.get('/api/service-tickets', requireAuth(), async (req, res) => {
  const { unitName } = req.query;
  const targetDate = req.query.date || todayBogota();
  if (!unitName) return res.status(400).json({ error: 'Missing unitName' });
  await ensureDemoDataForDate(targetDate);

  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY process_id ORDER BY start_date DESC) AS rn_last,
              MIN(CASE WHEN entity_status = 6 THEN start_date END) OVER (PARTITION BY process_id) AS service_start_date
       FROM turnos_detalle
       WHERE start_date::date = $1 AND oficina ILIKE $2 AND entity_status NOT IN (40,41) AND resolution <> '4'
     )
     SELECT process_id AS "ProcessId", service_name AS "ServiceName",
            service_time_warning AS "ServiceTimeWarning", service_time_critical AS "ServiceTimeCritical",
            TO_CHAR(service_start_date, 'YYYY-MM-DD"T"HH24:MI:SS') AS "StartDate",
            EXTRACT(EPOCH FROM (NOW() - service_start_date))::int AS "SecondsServing"
     FROM ranked
     WHERE rn_last = 1 AND entity_status = 6
     ORDER BY service_start_date`,
    [targetDate, `%${unitName}%`],
  );
  res.json(rows);
});

app.post('/api/admin/seed-demo', requireAuth('admin'), async (req, res) => {
  const date = req.body.date || todayBogota();
  await seedDemoData(date);
  res.json({ success: true, date });
});

app.post('/api/ai-chat', requireAuth(), async (req, res) => {
  const { message, history = [], context = {} } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Mensaje requerido' });
  }
  if (!ai) {
    return res.status(503).json({ error: 'GEMINI_API_KEY no configurada en el servidor' });
  }

  const systemPrompt = `Eres un asistente inteligente llamado "Asistente de Datos en Vivo", experto en analisis de datos de turnos y atencion al cliente. Estas embebido en un dashboard en vivo.
Tu trabajo es responder preguntas del supervisor usando solo el siguiente contexto JSON.

CONTEXTO ACTUAL:
${JSON.stringify(context, null, 2)}

CONOCIMIENTO DE DATOS:
- WaitingByUnit contiene metricas por sede, incluyendo tiempos de espera.
- dailyStats contiene resumen del dia.
- AGENTES_POR_UNIDAD contiene conteos de agentes por sede y estado.
- TODOS_LOS_AGENTES_ACTIVOS contiene agentes activos, sede, funcion y estado.
- AGENTES_DETALLE_UNIDAD aparece cuando el usuario abre el detalle de una sede.

Reglas:
1. Responde en espanol, de forma breve, amable y directa.
2. Usa Markdown solo cuando ayude a leer metricas o listas.
3. No inventes datos. Usa unicamente el JSON provisto.
4. Si faltan datos para responder, dilo claramente.
5. "AgentsIdle" significa "Agentes Inactivos"; no lo llames disponibles.
6. Si muestras tiempos o duraciones en segundos, conviertelos a formato HH:MM:SS.
7. Si preguntan algo fuera del dashboard, indica que solo tienes acceso a la vision actual.`;

  const contents = [
    ...history.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(msg.content || '') }],
    })),
    {
      role: 'user',
      parts: [{ text: String(message) }],
    },
  ];

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2,
      },
    });

    res.json({ reply: response.text || 'No pude generar una respuesta con los datos actuales.', model: GEMINI_MODEL });
  } catch (error) {
    console.error('[AI-Chat] Error:', error);
    res.status(500).json({
      error: 'Hubo un error procesando la solicitud de chat.',
      model: GEMINI_MODEL,
    });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

await initDatabase();
if (process.env.SEED_DEMO_ON_START !== 'false') {
  await seedDemoData(todayBogota());
}

app.listen(port, () => {
  console.log(`Local dashboard server running at http://0.0.0.0:${port}`);
});
