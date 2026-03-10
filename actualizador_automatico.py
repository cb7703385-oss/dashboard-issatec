import time
import pandas as pd
from google.cloud import bigquery
from google.oauth2 import service_account
from sqlalchemy import create_engine
import urllib

# =====================================================
# 1. CONFIGURACIÓN GENERAL
# =====================================================
PROJECT_ID = "master-reactor-476520-p0"
DATASET_ID = "Dislive"
TABLE_FINAL = "Turnos_Detalle"
TABLE_STAGING = "Turnos_Detalle_staging"
TABLE_DASHBOARD = "UnitSupervisorDashboardRegional"
TABLE_AGENTS = "UnitSupervisorDashboardRegional_Agents"
ruta_json = r"C:\Users\cburgos\OneDrive - Tveez Colombia S.A\Documentos\credenciales\mi_bigquery.json"

# --- Conexiones base ---
creds = service_account.Credentials.from_service_account_file(ruta_json)
client = bigquery.Client(credentials=creds, project=PROJECT_ID)

params = urllib.parse.quote_plus(
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=10.1.0.4;"
    "DATABASE=QFlow64Beta;"
    "UID=powerbilogin;"
    "PWD=P0w3rB1$;"
    "Connect Timeout=30;" 
)
engine = create_engine(f"mssql+pyodbc:///?odbc_connect={params}")

# Tiempo de espera entre actualizaciones (en segundos)
TIEMPO_ESPERA = 90

print(f"🚀 Iniciando MODO AUTOMÁTICO (Actualización cada {TIEMPO_ESPERA} segundos)...")
print("⚠️  Para detener el proceso en cualquier momento, presiona [Ctrl + C] o la 'X' de la ventana.")

# =====================================================
# BUCLE INFINITO
# =====================================================
try:
    while True:
        print("\n" + "="*50)
        print(f"🕒 Iniciando ciclo: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')}")
        start_total = time.time()

        try:
            # =====================================================
            # 2. PROCESO: TURNOS DETALLE
            # =====================================================
            print("--- 1️⃣ TURNOS DETALLE ---")
            start_step = time.time()
            
            query_turnos = """
            SELECT StepId, ProcessId, ServiceId, EntityStatus, Duration, 
                   StartDate, Resolution, ServiceName, Oficina, 
                   WaitingTimeWarning, WaitingTimeCritical, 
                   ServiceTimeWarning, ServiceTimeCritical, WaitingTimeStandard,
                   GETDATE() AS LastUpdate
            FROM qfr.vw_Turnos_Detalle 
            WHERE StartDate >= CAST(GETDATE() AS DATE)
            """
            df_turnos = pd.read_sql(query_turnos, engine)
            print(f"📥 Extracción SQL: {len(df_turnos)} filas ({time.time()-start_step:.2f}s)")

            if not df_turnos.empty:
                num_cols_t = ["StepId", "ProcessId", "ServiceId", "EntityStatus", "Duration", 
                              "WaitingTimeWarning", "WaitingTimeCritical", "ServiceTimeWarning", 
                              "ServiceTimeCritical", "WaitingTimeStandard"]
                
                for col in num_cols_t:
                    if col in df_turnos.columns:
                        df_turnos[col] = pd.to_numeric(df_turnos[col], errors='coerce').fillna(0).astype('int64')

                start_load = time.time()
                job_config_t = bigquery.LoadJobConfig(
                    write_disposition="WRITE_TRUNCATE",
                    source_format=bigquery.SourceFormat.PARQUET
                )
                client.load_table_from_dataframe(df_turnos, f"{DATASET_ID}.{TABLE_STAGING}", job_config=job_config_t).result()
                
                create_sql = f"""
                CREATE TABLE IF NOT EXISTS `{PROJECT_ID}.{DATASET_ID}.{TABLE_FINAL}`
                (StepId INT64, ProcessId INT64, ServiceId INT64, EntityStatus INT64, Duration INT64,
                 StartDate TIMESTAMP, Resolution STRING, ServiceName STRING, Oficina STRING,
                 WaitingTimeWarning INT64, WaitingTimeCritical INT64, ServiceTimeWarning INT64, 
                 ServiceTimeCritical INT64, WaitingTimeStandard INT64, LastUpdate TIMESTAMP)
                PARTITION BY DATE(StartDate) CLUSTER BY Oficina, ServiceName, ServiceId, ProcessId
                """
                client.query(create_sql).result()

                merge_sql = f"""
                MERGE `{PROJECT_ID}.{DATASET_ID}.{TABLE_FINAL}` T
                USING `{PROJECT_ID}.{DATASET_ID}.{TABLE_STAGING}` S
                ON T.StepId = S.StepId AND T.StartDate = TIMESTAMP(S.StartDate)
                WHEN MATCHED THEN UPDATE SET
                    T.ProcessId=S.ProcessId, T.ServiceId=S.ServiceId, T.EntityStatus=S.EntityStatus,
                    T.Duration=S.Duration, T.Resolution=CAST(S.Resolution AS STRING),
                    T.ServiceName=S.ServiceName, T.Oficina=S.Oficina,
                    T.WaitingTimeWarning=S.WaitingTimeWarning, T.WaitingTimeCritical=S.WaitingTimeCritical,
                    T.ServiceTimeWarning=S.ServiceTimeWarning, T.ServiceTimeCritical=S.ServiceTimeCritical,
                    T.WaitingTimeStandard=S.WaitingTimeStandard, T.LastUpdate=TIMESTAMP(S.LastUpdate)
                WHEN NOT MATCHED THEN INSERT
                (StepId, ProcessId, ServiceId, EntityStatus, Duration, StartDate, Resolution, ServiceName, Oficina, 
                 WaitingTimeWarning, WaitingTimeCritical, ServiceTimeWarning, ServiceTimeCritical, WaitingTimeStandard, LastUpdate)
                VALUES
                (S.StepId, S.ProcessId, S.ServiceId, S.EntityStatus, S.Duration, TIMESTAMP(S.StartDate), CAST(S.Resolution AS STRING), S.ServiceName, S.Oficina, 
                 S.WaitingTimeWarning, S.WaitingTimeCritical, S.ServiceTimeWarning, S.ServiceTimeCritical, S.WaitingTimeStandard, TIMESTAMP(S.LastUpdate))
                """
                
                merge_job = client.query(merge_sql)
                merge_job.result()
                print(f"🔄 MERGE completado ({time.time()-start_load:.2f}s)")

            # =====================================================
            # 3. PROCESO: DASHBOARD REGIONAL
            # =====================================================
            print("--- 2️⃣ DASHBOARD REGIONAL ---")
            start_step = time.time()
            df_dashboard = pd.read_sql("EXEC [qfr].[UnitSupervisorDashboardRegional]", engine)
            print(f"📥 SP Dashboard: {len(df_dashboard)} filas ({time.time()-start_step:.2f}s)")

            if not df_dashboard.empty:
                num_cols_d = ["UnitId", "CurrentlyWaiting", "CurrentlyInService", "ServedToday", "ArrivedToday",
                              "AgentsSignedIn", "AgentsIdle", "AgentsInBackOffice", "AgentsInService", "AgentsInReception"]
                for col in num_cols_d:
                    if col in df_dashboard.columns:
                        df_dashboard[col] = pd.to_numeric(df_dashboard[col], errors="coerce").fillna(0).astype("int64")

                start_load_d = time.time()
                job_config_d = bigquery.LoadJobConfig(write_disposition="WRITE_TRUNCATE", source_format=bigquery.SourceFormat.PARQUET)
                client.load_table_from_dataframe(df_dashboard, f"{DATASET_ID}.{TABLE_DASHBOARD}", job_config=job_config_d).result()
                print(f"🚀 BQ Actualizado ({time.time()-start_load_d:.2f}s)")

            # =====================================================
            # 4. PROCESO: ESTADO DE AGENTES
            # =====================================================
            print("--- 3️⃣ ESTADO DE AGENTES ---")
            start_step_a = time.time()
            df_agents = pd.read_sql("EXEC [qfr].[UnitSupervisorDashboardRegional_Agents]", engine)
            print(f"📥 SP Agentes: {len(df_agents)} filas ({time.time()-start_step_a:.2f}s)")

            if not df_agents.empty:
                if "UnitId" in df_agents.columns:
                    df_agents["UnitId"] = pd.to_numeric(df_agents["UnitId"], errors="coerce").fillna(0).astype("int64")
                if "UserId" in df_agents.columns:
                    df_agents["UserId"] = pd.to_numeric(df_agents["UserId"], errors="coerce").fillna(0).astype("int64")

                start_load_a = time.time()
                job_config_a = bigquery.LoadJobConfig(write_disposition="WRITE_TRUNCATE", source_format=bigquery.SourceFormat.PARQUET)
                client.load_table_from_dataframe(df_agents, f"{DATASET_ID}.{TABLE_AGENTS}", job_config=job_config_a).result()
                print(f"👷 BQ Actualizado ({time.time()-start_load_a:.2f}s)")

            print("-" * 50)
            print(f"✅ CICLO EXITOSO EN {time.time()-start_total:.2f}s")
            
        except Exception as e:
            # Si hay un fallo de red o BD, el try-catch evita que el script completo muera.
            print(f"❌ ERROR en este ciclo: {e}")
            print("🔄 Se intentará nuevamente en el próximo ciclo.")

        # Esperar 90 segundos antes del siguiente ciclo
        print(f"⏳ Esperando {TIEMPO_ESPERA} segundos...")
        time.sleep(TIEMPO_ESPERA)

# Capturamos el Ctrl+C para tener una salida limpia sin errores feos en la consola
except KeyboardInterrupt:
    print("\n" + "="*50)
    print("🛑 PROCESO DETENIDO MANUALMENTE POR EL USUARIO (Ctrl+C).")
    print("="*50)
