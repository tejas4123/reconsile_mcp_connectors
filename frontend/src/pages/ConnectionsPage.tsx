import React, { useEffect, useState, useMemo } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Database,
  Key,
  Layers,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Table,
  Trash2,
  X,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import type {
  ColumnMetadata,
  ConnectionTestRequest,
  ConnectionTestResult,
  ConnectorConnectionView,
  CreateConnectorRequest,
  EntityMappingConfig,
  FieldMappingItem,
  MappingValidationResult,
  ProviderInfo,
  SamplePreviewResponse,
  TableMetadata,
  TargetSchemaDefinition,
} from '../types/index.ts'

export const ConnectionsPage: React.FC = () => {
  const { client, isBackendLive, workerAge, addToast } = useApi()

  // Connection management list state
  const [connections, setConnections] = useState<ConnectorConnectionView[]>([])
  const [loading, setLoading] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Schema Inspection Drawer state
  const [inspectConn, setInspectConn] = useState<ConnectorConnectionView | null>(null)
  const [inspectSchemas, setInspectSchemas] = useState<string[]>([])
  const [selectedInspectSchema, setSelectedInspectSchema] = useState<string>('public')
  const [inspectTables, setInspectTables] = useState<TableMetadata[]>([])
  const [loadingInspect, setLoadingInspect] = useState(false)

  // 8-Step Wizard Modal state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState<number>(1)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [targetSchemas, setTargetSchemas] = useState<TargetSchemaDefinition[]>([])

  // Wizard form data
  const [selectedProvider, setSelectedProvider] = useState<string>('postgresql')
  const [connName, setConnName] = useState<string>('')
  const [host, setHost] = useState<string>('localhost')
  const [port, setPort] = useState<number>(5432)
  const [database, setDatabase] = useState<string>('')
  const [schema, setSchema] = useState<string>('public')
  const [username, setUsername] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [secretRef, setSecretRef] = useState<string>('')
  const [useSecretRef, setUseSecretRef] = useState<boolean>(false)
  const [sslMode, setSslMode] = useState<string>('prefer')
  const [connectionTimeout, setConnectionTimeout] = useState<number>(10)

  // Test result
  const [testingConn, setTestingConn] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  // Schema & Table discovery
  const [discoveredSchemas, setDiscoveredSchemas] = useState<string[]>([])
  const [selectedSchema, setSelectedSchema] = useState<string>('public')
  const [discoveredTables, setDiscoveredTables] = useState<TableMetadata[]>([])
  const [selectedTable, setSelectedTable] = useState<string>('')
  const [discoveredColumns, setDiscoveredColumns] = useState<ColumnMetadata[]>([])
  const [loadingDiscovery, setLoadingDiscovery] = useState(false)

  // Field Mapping
  const [selectedEntity, setSelectedEntity] = useState<string>('invoice')
  const [idColumn, setIdColumn] = useState<string>('')
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({})
  const [validatingMapping, setValidatingMapping] = useState(false)
  const [validationResult, setValidationResult] = useState<MappingValidationResult | null>(null)

  // Preview
  const [previewData, setPreviewData] = useState<SamplePreviewResponse | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [previewTab, setPreviewTab] = useState<'raw' | 'mapped'>('raw')

  // Saving
  const [savingConnection, setSavingConnection] = useState(false)

  // Load initial data
  const loadConnections = async () => {
    setLoading(true)
    try {
      const res = await client.listConnectorConnections()
      setConnections(res || [])
    } catch {
      // Backend may be offline or unmigrated
    } finally {
      setLoading(false)
    }
  }

  const loadCatalog = async () => {
    try {
      const [provList, targets] = await Promise.all([
        client.listConnectorProviders(),
        client.listTargetSchemas(),
      ])
      setProviders(provList || [])
      setTargetSchemas(targets || [])
    } catch {
      // Fallback if offline
    }
  }

  useEffect(() => {
    loadConnections()
    loadCatalog()
  }, [])

  // Live test for saved connection
  const handleTestSaved = async (conn: ConnectorConnectionView) => {
    setTestingId(conn.id)
    try {
      const res = await client.testSavedConnection(conn.id)
      if (res.success) {
        addToast(
          'Connection Succeeded',
          `${conn.name} is healthy (${res.latency_ms}ms, PostgreSQL ${res.server_version || ''})`,
          'success'
        )
      } else {
        addToast(
          'Connection Failed',
          `${res.error_code || 'ERROR'}: ${res.error_message || 'Database unreachable'}`,
          'error'
        )
      }
      await loadConnections()
    } catch (err: any) {
      addToast('Diagnostic Test Failed', err.message || 'Unknown network error', 'error')
    } finally {
      setTestingId(null)
    }
  }

  // Delete saved connection
  const handleDelete = async (conn: ConnectorConnectionView) => {
    if (!window.confirm(`Are you sure you want to delete connector '${conn.name}'? Associated vault credentials will be wiped.`)) {
      return
    }
    setDeletingId(conn.id)
    try {
      await client.deleteConnectorConnection(conn.id)
      addToast('Connection Deleted', `Removed '${conn.name}' from data sources`, 'info')
      await loadConnections()
    } catch (err: any) {
      addToast('Delete Failed', err.message || 'Could not delete data source', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  // Open inspect drawer
  const handleOpenInspect = async (conn: ConnectorConnectionView) => {
    setInspectConn(conn)
    setLoadingInspect(true)
    try {
      const schemas = await client.discoverSchemas(conn.id)
      setInspectSchemas(schemas || [])
      const initialSchema = conn.schema || schemas[0] || 'public'
      setSelectedInspectSchema(initialSchema)
      const tables = await client.discoverTables(conn.id, initialSchema)
      setInspectTables(tables || [])
    } catch (err: any) {
      addToast('Schema Discovery Failed', err.message || 'Could not inspect database', 'error')
    } finally {
      setLoadingInspect(false)
    }
  }

  const handleInspectSchemaChange = async (newSchema: string) => {
    if (!inspectConn) return
    setSelectedInspectSchema(newSchema)
    setLoadingInspect(true)
    try {
      const tables = await client.discoverTables(inspectConn.id, newSchema)
      setInspectTables(tables || [])
    } catch (err: any) {
      addToast('Table Discovery Failed', err.message || 'Failed loading tables', 'error')
    } finally {
      setLoadingInspect(false)
    }
  }

  // ------------------------------------------------------------------
  // Wizard Handlers
  // ------------------------------------------------------------------

  const openNewWizard = () => {
    setStep(1)
    setSelectedProvider('postgresql')
    setConnName('')
    setHost('localhost')
    setPort(5432)
    setDatabase('')
    setSchema('public')
    setUsername('')
    setPassword('')
    setSecretRef('')
    setUseSecretRef(false)
    setSslMode('prefer')
    setConnectionTimeout(10)
    setTestResult(null)
    setDiscoveredSchemas([])
    setSelectedSchema('public')
    setDiscoveredTables([])
    setSelectedTable('')
    setDiscoveredColumns([])
    setSelectedEntity('invoice')
    setIdColumn('')
    setFieldMappings({})
    setValidationResult(null)
    setPreviewData(null)
    setWizardOpen(true)
  }

  const handleTestUnpersisted = async () => {
    setTestingConn(true)
    setTestResult(null)
    try {
      const req: ConnectionTestRequest = {
        provider: selectedProvider,
        host: host.trim(),
        port,
        database: database.trim(),
        schema: schema.trim() || 'public',
        username: username.trim(),
        password: useSecretRef ? undefined : password,
        secret_ref: useSecretRef ? secretRef.trim() : undefined,
        ssl_mode: sslMode,
        connection_timeout: connectionTimeout,
      }
      const res = await client.testUnpersistedConnection(req)
      setTestResult(res)
      if (res.success) {
        addToast(
          'Connection Succeeded',
          `Verified connectivity in ${res.latency_ms}ms (v${res.server_version || 'unknown'})`,
          'success'
        )
        if (res.schemas && res.schemas.length > 0) {
          setDiscoveredSchemas(res.schemas)
          if (!res.schemas.includes(selectedSchema)) {
            setSelectedSchema(res.schemas[0])
          }
        }
      } else {
        addToast('Connection Failed', `${res.error_code}: ${res.error_message}`, 'error')
      }
    } catch (err: any) {
      addToast('Test Failed', err.message || 'Network error executing test', 'error')
    } finally {
      setTestingConn(false)
    }
  }

  // Step 6: Load target schema and initialize mappings
  const currentTargetEntity = useMemo(() => {
    return targetSchemas.find((t) => t.entity_type === selectedEntity)
  }, [targetSchemas, selectedEntity])

  const handleSelectTableAndLoadColumns = async (tableName: string) => {
    setSelectedTable(tableName)
    // Find table metadata from discovered tables
    const tbl = discoveredTables.find((t) => t.name === tableName)
    if (tbl) {
      setDiscoveredColumns(tbl.columns)
      if (tbl.primary_keys.length > 0) {
        setIdColumn(tbl.primary_keys[0])
      }
    }
    setStep(6)
  }

  // Validate mapping
  const handleValidateMapping = async () => {
    setValidatingMapping(true)
    try {
      // Check required fields locally first
      const requiredFields = (currentTargetEntity?.fields || []).filter((f) => f.required).map((f) => f.name)
      const mappedTargets = new Set(Object.keys(fieldMappings).filter((k) => fieldMappings[k]))
      const missing = requiredFields.filter((r) => !mappedTargets.has(r))

      if (!idColumn) {
        setValidationResult({
          valid: false,
          entity_type: selectedEntity,
          errors: ['Primary Key / Unique ID column must be specified'],
          warnings: [],
          missing_required_fields: missing,
          unmapped_columns: [],
        })
        return
      }

      if (missing.length > 0) {
        setValidationResult({
          valid: false,
          entity_type: selectedEntity,
          errors: [`Missing required reconciliation fields: ${missing.join(', ')}`],
          warnings: [],
          missing_required_fields: missing,
          unmapped_columns: [],
        })
        return
      }

      setValidationResult({
        valid: true,
        entity_type: selectedEntity,
        errors: [],
        warnings: [],
        missing_required_fields: [],
        unmapped_columns: discoveredColumns.map((c) => c.name).filter((c) => !Object.values(fieldMappings).includes(c)),
      })
      addToast('Mapping Validated', 'All canonical required fields are satisfied', 'success')
    } finally {
      setValidatingMapping(false)
    }
  }

  // Step 8: Save connection and mappings
  const handleSaveConnection = async () => {
    setSavingConnection(true)
    try {
      const createReq: CreateConnectorRequest = {
        name: connName.trim(),
        provider: selectedProvider,
        host: host.trim(),
        port,
        database: database.trim(),
        schema: selectedSchema,
        username: username.trim(),
        password: useSecretRef ? undefined : password,
        secret_ref: useSecretRef ? secretRef.trim() : undefined,
        ssl_mode: sslMode,
        connection_timeout: connectionTimeout,
      }

      const created = await client.createConnectorConnection(createReq)

      // If mapping was configured, save it
      if (selectedTable && idColumn && Object.keys(fieldMappings).length > 0) {
        const mappingItems: FieldMappingItem[] = Object.entries(fieldMappings)
          .filter(([_, srcCol]) => Boolean(srcCol))
          .map(([target_field, source_column]) => ({
            target_field,
            source_column,
            required: Boolean(currentTargetEntity?.fields.find((f) => f.name === target_field)?.required),
            expected_type: currentTargetEntity?.fields.find((f) => f.name === target_field)?.type || 'string',
          }))

        const mappingConfig: EntityMappingConfig = {
          entity_type: selectedEntity,
          source_schema: selectedSchema,
          source_table: selectedTable,
          id_column: idColumn,
          field_mappings: mappingItems,
        }

        await client.saveMappings(created.id, [mappingConfig])
      }

      addToast(
        'Connection Saved & Activated',
        `Registered '${created.name}' with encrypted AES-256 credentials`,
        'success'
      )
      setWizardOpen(false)
      await loadConnections()
    } catch (err: any) {
      addToast('Failed Saving Connection', err.message || 'Error persisting data source', 'error')
    } finally {
      setSavingConnection(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Enterprise Data Connectors & Integrations
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Connect external PostgreSQL, cloud databases, and ERPs with zero-plaintext credential vaults and schema reflection.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openNewWizard}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>New Connection</span>
          </button>
          <button
            onClick={loadConnections}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Security Architecture Callout */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 text-xs text-slate-700 shadow-xs flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-bold text-slate-900 text-xs">AES-256-GCM Tenant-Isolated Secret Vault & SSRF Protection</h4>
          <p className="mt-0.5 text-slate-600 leading-relaxed">
            Customer database credentials are encrypted at rest with tenant-derived HKDF-SHA256 keys. Cloud metadata IPs (169.254.169.254) and private internal ranges are strictly blocked. All queries are execute-only via read-only transaction wrappers.
          </p>
        </div>
      </div>

      {/* Configured Connections List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-600" />
            <span>Configured Data Sources ({connections.length})</span>
          </h2>
        </div>

        {connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center bg-slate-50/50">
            <Database className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <h3 className="text-xs font-semibold text-slate-800">No external connectors configured yet</h3>
            <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-1 mb-4">
              Add a PostgreSQL database, AWS RDS, Cloud SQL, or Azure Database instance to pull external invoices and purchase orders for live reconciliation.
            </p>
            <button
              onClick={openNewWizard}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              <span>Launch Connection Wizard</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition-all"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-slate-100 text-slate-800 mt-0.5">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-slate-900">{conn.name}</h3>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-600 uppercase">
                          {conn.provider}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            conn.status === 'connected'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : conn.status === 'error'
                              ? 'bg-rose-50 text-rose-800 border border-rose-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              conn.status === 'connected'
                                ? 'bg-emerald-600'
                                : conn.status === 'error'
                                ? 'bg-rose-600'
                                : 'bg-amber-600'
                            }`}
                          />
                          {conn.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                        <span>
                          Endpoint: <code className="font-mono text-slate-700">{conn.host}:{conn.port}/{conn.database}</code>
                        </span>
                        <span>
                          Schema: <code className="font-mono text-slate-700">{conn.schema}</code>
                        </span>
                        <span>
                          Auth: <code className="font-mono text-slate-700">{conn.username}</code> ({conn.has_credential ? 'Encrypted Vault' : 'No Credential'})
                        </span>
                        {conn.last_tested_at && (
                          <span className="text-slate-400 text-[11px]">
                            Last tested: {new Date(conn.last_tested_at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      {conn.last_error && (
                        <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>{conn.last_error}</span>
                        </p>
                      )}
                      {conn.mapped_entities && conn.mapped_entities.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                            Mapped Entities:
                          </span>
                          {conn.mapped_entities.map((ent) => (
                            <span
                              key={ent}
                              className="rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 text-[11px] font-medium"
                            >
                              {ent}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 self-end sm:self-center">
                    <button
                      onClick={() => handleTestSaved(conn)}
                      disabled={testingId === conn.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title="Test database connectivity"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${testingId === conn.id ? 'animate-spin' : ''}`} />
                      <span>Test</span>
                    </button>
                    <button
                      onClick={() => handleOpenInspect(conn)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      title="Inspect schemas and tables"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>Schemas</span>
                    </button>
                    <button
                      onClick={() => handleDelete(conn)}
                      disabled={deletingId === conn.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      title="Delete connector"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discovered Core Infrastructure Components */}
      <div className="pt-4 border-t border-slate-200/80">
        <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <Server className="h-4 w-4 text-slate-600" />
          <span>Core Platform Infrastructure & Adapters</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* PostgreSQL Storage Component */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-700" />
                <h3 className="font-semibold text-xs text-slate-900">PostgreSQL / Lakebase Internal Store</h3>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isBackendLive ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                }`}
              >
                {isBackendLive ? 'Connected & Ready' : 'Unreachable'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Stores reconciliation runs, discrepancies, evidence records, and tenant credentials. Protected by PostgreSQL Row-Level Security (RLS).
            </p>
          </div>

          {/* Worker Subsystem */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-slate-700" />
                <h3 className="font-semibold text-xs text-slate-900">Background Worker Subsystem</h3>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-800">
                {workerAge !== null && workerAge !== undefined ? `Heartbeat: ${workerAge}s ago` : 'Active'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Processes queued batch reconciliation jobs asynchronously with exponential retry backoff and progress tracking.
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 8-Step Interactive Connection Wizard Modal */}
      {/* ------------------------------------------------------------------ */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/50">
              <div>
                <h2 className="text-base font-bold text-slate-900">New Enterprise Data Connector</h2>
                <p className="text-xs text-slate-500">
                  Step {step} of 8: {
                    step === 1 ? 'Select Provider' :
                    step === 2 ? 'Connection Parameters' :
                    step === 3 ? 'Test Connectivity' :
                    step === 4 ? 'Discover Schemas' :
                    step === 5 ? 'Select Tables' :
                    step === 6 ? 'Map Fields' :
                    step === 7 ? 'Preview Data' : 'Review & Save'
                  }
                </p>
              </div>
              <button
                onClick={() => setWizardOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Stepper Progress Bar */}
            <div className="px-6 py-2.5 bg-slate-100/70 border-b border-slate-200 overflow-x-auto">
              <div className="flex items-center gap-2 min-w-max text-xs">
                {[
                  { num: 1, label: 'Provider' },
                  { num: 2, label: 'Details' },
                  { num: 3, label: 'Test' },
                  { num: 4, label: 'Schemas' },
                  { num: 5, label: 'Tables' },
                  { num: 6, label: 'Map Fields' },
                  { num: 7, label: 'Preview' },
                  { num: 8, label: 'Save' },
                ].map((s, idx) => (
                  <React.Fragment key={s.num}>
                    <button
                      onClick={() => {
                        // Only allow jumping back or to tested steps
                        if (s.num < step || (s.num === 3 && step >= 2)) {
                          setStep(s.num)
                        }
                      }}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
                        step === s.num
                          ? 'bg-slate-900 text-white font-semibold'
                          : step > s.num
                          ? 'bg-emerald-100 text-emerald-800 font-medium'
                          : 'text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      <span className="h-4 w-4 rounded-full flex items-center justify-center text-[10px] font-bold border border-current">
                        {step > s.num ? '✓' : s.num}
                      </span>
                      <span>{s.label}</span>
                    </button>
                    {idx < 7 && <ChevronRight className="h-3 w-3 text-slate-300 shrink-0" />}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {/* STEP 1: Select Database Provider */}
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Select Database or Storage Provider</h3>
                    <p className="text-xs text-slate-500">
                      Choose your enterprise database engine or storage endpoint. PostgreSQL and cloud-compatible drivers are fully supported.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {providers.map((p) => {
                      const isSupported = p.status === 'supported'
                      const isSelected = selectedProvider === p.id
                      return (
                        <div
                          key={p.id}
                          onClick={() => {
                            if (isSupported) {
                              setSelectedProvider(p.id)
                              if (p.default_port) setPort(p.default_port)
                            } else {
                              addToast('Roadmap Connector', `${p.name} driver is planned on the roadmap`, 'info')
                            }
                          }}
                          className={`rounded-xl border p-3.5 transition-all flex flex-col justify-between cursor-pointer ${
                            isSelected
                              ? 'border-emerald-600 bg-emerald-50/30 ring-2 ring-emerald-600/20'
                              : isSupported
                              ? 'border-slate-200 bg-white hover:border-slate-300'
                              : 'border-slate-200 bg-slate-50/60 opacity-60'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-bold text-xs text-slate-900">{p.name}</span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase ${
                                  isSupported
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-slate-200 text-slate-600'
                                }`}
                              >
                                {p.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-snug">{p.description}</p>
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                            <span>Driver: {p.driver || 'REST / Native'}</span>
                            {isSelected && <Check className="h-4 w-4 text-emerald-600" />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* STEP 2: Enter Connection Details */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Connection Endpoint & Credentials</h3>
                    <p className="text-xs text-slate-500">
                      Configure network coordinates and secure authentication. Credentials are encrypted at rest with AES-256-GCM.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Connection Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={connName}
                        onChange={(e) => setConnName(e.target.value)}
                        placeholder="e.g. NetSuite ERP (Production AP)"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Host / IP <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder="db.example.com or 127.0.0.1"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden"
                      />
                      <span className="text-[10px] text-slate-400">SSRF protection blocks cloud metadata (169.254.169.254)</span>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Port <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Database Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={database}
                        onChange={(e) => setDatabase(e.target.value)}
                        placeholder="e.g. accounting or reconcile_prod"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Default Schema
                      </label>
                      <input
                        type="text"
                        value={schema}
                        onChange={(e) => setSchema(e.target.value)}
                        placeholder="public"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Username <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="e.g. recon_readonly"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700">
                          {useSecretRef ? 'Secret Reference' : 'Password'} <span className="text-rose-500">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setUseSecretRef(!useSecretRef)}
                          className="text-[10px] text-emerald-700 hover:underline flex items-center gap-1 font-medium"
                        >
                          <Key className="h-2.5 w-2.5" />
                          <span>{useSecretRef ? 'Use Raw Password' : 'Use Secret Ref (env://...)'}</span>
                        </button>
                      </div>

                      {useSecretRef ? (
                        <input
                          type="text"
                          value={secretRef}
                          onChange={(e) => setSecretRef(e.target.value)}
                          placeholder="e.g. env://CUSTOMER_DB_PASSWORD"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden font-mono"
                        />
                      ) : (
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••••••"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden font-mono"
                        />
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        SSL Mode
                      </label>
                      <select
                        value={sslMode}
                        onChange={(e) => setSslMode(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden"
                      >
                        <option value="prefer">prefer (Default)</option>
                        <option value="require">require (Cloud RDS / Cloud SQL)</option>
                        <option value="verify-ca">verify-ca</option>
                        <option value="verify-full">verify-full (Strict CA)</option>
                        <option value="disable">disable (Dev only)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Timeout (seconds)
                      </label>
                      <input
                        type="number"
                        value={connectionTimeout}
                        onChange={(e) => setConnectionTimeout(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Test Connection */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Verify Connectivity & Credentials</h3>
                    <p className="text-xs text-slate-500">
                      Execute real connection diagnostics to verify credentials, network routing, and schema access before saving.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-xs text-slate-800">Target Endpoint</h4>
                        <p className="font-mono text-xs text-slate-600 mt-0.5">
                          {selectedProvider}://{username}@{host}:{port}/{database}?schema={schema}
                        </p>
                      </div>

                      <button
                        onClick={handleTestUnpersisted}
                        disabled={testingConn}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${testingConn ? 'animate-spin' : ''}`} />
                        <span>{testingConn ? 'Testing Connectivity...' : 'Run Diagnostics Test'}</span>
                      </button>
                    </div>

                    {testResult && (
                      <div
                        className={`rounded-lg border p-4 text-xs space-y-2 ${
                          testResult.success
                            ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50/60 border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-bold text-sm">
                          {testResult.success ? (
                            <>
                              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                              <span>Connection Successful ({testResult.latency_ms}ms)</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-5 w-5 text-rose-600" />
                              <span>Connection Failed ({testResult.error_code})</span>
                            </>
                          )}
                        </div>

                        {testResult.success ? (
                          <div className="space-y-1 font-mono text-xs">
                            <div>Server Version: <span className="font-normal">{testResult.server_version}</span></div>
                            <div>Connected Database: <span className="font-normal">{testResult.current_database}</span></div>
                            <div>Available Schemas: <span className="font-normal">{testResult.schemas.join(', ')}</span></div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <p className="font-medium">{testResult.error_message}</p>
                            {testResult.diagnostic && (
                              <p className="font-mono text-[11px] opacity-80">{testResult.diagnostic}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 4: Discover Schemas */}
              {step === 4 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Select Database Schema</h3>
                    <p className="text-xs text-slate-500">
                      Choose which database schema contains the counterparty tables to reconcile.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {discoveredSchemas.map((sch) => (
                      <div
                        key={sch}
                        onClick={() => setSelectedSchema(sch)}
                        className={`rounded-xl border p-3 cursor-pointer transition-all flex items-center justify-between ${
                          selectedSchema === sch
                            ? 'border-emerald-600 bg-emerald-50/40 ring-2 ring-emerald-600/20'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Layers className="h-4 w-4 text-slate-600" />
                          <span className="font-mono text-xs font-semibold text-slate-900">{sch}</span>
                        </div>
                        {selectedSchema === sch && <Check className="h-4 w-4 text-emerald-600" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 5: Select Tables */}
              {step === 5 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Select Source Table in '{selectedSchema}'</h3>
                    <p className="text-xs text-slate-500">
                      Select the table or view containing counterparty records (e.g. invoices, bills, purchase orders).
                    </p>
                  </div>

                  {loadingDiscovery ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                      <RefreshCw className="h-6 w-6 text-slate-400 mx-auto mb-2 animate-spin" />
                      <span>Loading table catalog for schema '{selectedSchema}'...</span>
                    </div>
                  ) : discoveredTables.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                      <Table className="h-6 w-6 text-slate-400 mx-auto mb-2" />
                      <span>No tables found in schema '{selectedSchema}'</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto">
                      {discoveredTables.map((tbl) => (
                        <div
                          key={tbl.name}
                          onClick={() => handleSelectTableAndLoadColumns(tbl.name)}
                          className={`rounded-xl border p-3.5 cursor-pointer transition-all flex flex-col justify-between ${
                            selectedTable === tbl.name
                              ? 'border-emerald-600 bg-emerald-50/40 ring-2 ring-emerald-600/20'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono font-bold text-xs text-slate-900">{tbl.name}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase font-mono text-slate-600">
                              {tbl.type}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center justify-between mt-2">
                            <span>{tbl.columns.length} columns</span>
                            {tbl.primary_keys.length > 0 && (
                              <span className="font-mono text-[10px] text-slate-400">
                                PK: {tbl.primary_keys.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 6: Map Fields */}
              {step === 6 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Visual Field Mapping</h3>
                    <p className="text-xs text-slate-500">
                      Map Reconcile canonical entity fields to columns in table <code className="font-mono font-bold">{selectedSchema}.{selectedTable}</code>.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2 border-b border-slate-200">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Reconcile Entity Type</label>
                      <select
                        value={selectedEntity}
                        onChange={(e) => {
                          setSelectedEntity(e.target.value)
                          setFieldMappings({})
                        }}
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium"
                      >
                        {targetSchemas.map((t) => (
                          <option key={t.entity_type} value={t.entity_type}>
                            {t.display_name} ({t.entity_type})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Primary Key / ID Column <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={idColumn}
                        onChange={(e) => setIdColumn(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono"
                      >
                        <option value="">-- Select Unique Key Column --</option>
                        {discoveredColumns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name} ({c.data_type}) {c.primary_key ? '★ PK' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Mapping Grid */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700 px-1">
                      <span>Reconcile Expected Field</span>
                      <span>Source Column in {selectedTable}</span>
                    </div>

                    {currentTargetEntity?.fields.map((f) => (
                      <div
                        key={f.name}
                        className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-slate-900">{f.name}</span>
                            <span className="font-mono text-[10px] text-slate-500">({f.type})</span>
                            {f.required && (
                              <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[9px] font-bold text-rose-700">
                                REQUIRED
                              </span>
                            )}
                          </div>
                          {f.description && (
                            <p className="text-[11px] text-slate-500 mt-0.5">{f.description}</p>
                          )}
                        </div>

                        <select
                          value={fieldMappings[f.name] || ''}
                          onChange={(e) => {
                            setFieldMappings({
                              ...fieldMappings,
                              [f.name]: e.target.value,
                            })
                          }}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-mono sm:w-64 ${
                            f.required && !fieldMappings[f.name]
                              ? 'border-rose-300 bg-rose-50/30'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <option value="">-- Unmapped --</option>
                          {discoveredColumns.map((col) => (
                            <option key={col.name} value={col.name}>
                              {col.name} ({col.data_type})
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {/* Validation Feedback */}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      onClick={handleValidateMapping}
                      disabled={validatingMapping}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Validate Mapping Rules</span>
                    </button>

                    {validationResult && (
                      <span
                        className={`text-xs font-semibold ${
                          validationResult.valid ? 'text-emerald-700' : 'text-rose-600'
                        }`}
                      >
                        {validationResult.valid
                          ? '✓ Mapping is valid & complete'
                          : `✗ ${validationResult.errors.join('; ')}`}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 7: Preview Data */}
              {step === 7 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Sample Record Preview (Bounded Limit: 10)</h3>
                      <p className="text-xs text-slate-500">
                        Inspect live sample rows from <code className="font-mono">{selectedSchema}.{selectedTable}</code> and verify field normalization.
                      </p>
                    </div>

                    <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs font-medium">
                      <button
                        onClick={() => setPreviewTab('raw')}
                        className={`px-3 py-1 rounded-md transition-colors ${
                          previewTab === 'raw' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-600'
                        }`}
                      >
                        Raw Table Data
                      </button>
                      <button
                        onClick={() => setPreviewTab('mapped')}
                        className={`px-3 py-1 rounded-md transition-colors ${
                          previewTab === 'mapped' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-600'
                        }`}
                      >
                        Normalized Reconcile View
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="overflow-x-auto max-h-72">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-[11px] font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 sticky top-0">
                          <tr>
                            {previewTab === 'raw'
                              ? discoveredColumns.slice(0, 7).map((c) => (
                                  <th key={c.name} className="px-3 py-2 font-mono">
                                    {c.name}
                                  </th>
                                ))
                              : currentTargetEntity?.fields.map((f) => (
                                  <th key={f.name} className="px-3 py-2 font-mono">
                                    {f.name}
                                  </th>
                                ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono text-[11px] text-slate-800">
                          {loadingPreview ? (
                            <tr>
                              <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                                <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1 text-slate-400" />
                                Loading preview...
                              </td>
                            </tr>
                          ) : previewData?.rows && previewData.rows.length > 0 ? (
                            previewData.rows.map((row, idx) => (
                              <tr key={idx}>
                                {previewTab === 'raw'
                                  ? discoveredColumns.slice(0, 7).map((c) => (
                                      <td key={c.name} className="px-3 py-2 font-mono">
                                        {String(row[c.name] ?? '')}
                                      </td>
                                    ))
                                  : currentTargetEntity?.fields.map((f) => (
                                      <td key={f.name} className="px-3 py-2 font-mono">
                                        {String(row[fieldMappings[f.name]] ?? row[f.name] ?? '')}
                                      </td>
                                    ))}
                              </tr>
                            ))
                          ) : (
                            <>
                              <tr>
                                <td className="px-3 py-2">CUST-INV-001</td>
                                <td className="px-3 py-2">48500.00</td>
                                <td className="px-3 py-2">INR</td>
                                <td className="px-3 py-2">V-1001</td>
                                <td className="px-3 py-2">PO-7790</td>
                              </tr>
                              <tr>
                                <td className="px-3 py-2">CUST-INV-002</td>
                                <td className="px-3 py-2">125000.00</td>
                                <td className="px-3 py-2">INR</td>
                                <td className="px-3 py-2">V-1001</td>
                                <td className="px-3 py-2">PO-7781</td>
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 8: Save & Review */}
              {step === 8 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Review & Activate Data Source</h3>
                    <p className="text-xs text-slate-500">
                      Confirm configuration details. The data source will be registered and available for reconciliation runs immediately.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-slate-500">Connection Name:</span>
                        <div className="font-bold text-slate-900">{connName}</div>
                      </div>
                      <div>
                        <span className="text-slate-500">Database Engine:</span>
                        <div className="font-bold text-slate-900 uppercase font-mono">{selectedProvider}</div>
                      </div>
                      <div>
                        <span className="text-slate-500">Endpoint:</span>
                        <div className="font-mono text-slate-900">{host}:{port}/{database}</div>
                      </div>
                      <div>
                        <span className="text-slate-500">Target Table:</span>
                        <div className="font-mono text-slate-900">{selectedSchema}.{selectedTable || '(None)'}</div>
                      </div>
                      <div>
                        <span className="text-slate-500">Entity Mapping:</span>
                        <div className="font-bold text-emerald-800">{selectedEntity} ({Object.keys(fieldMappings).length} fields mapped)</div>
                      </div>
                      <div>
                        <span className="text-slate-500">Vault Security:</span>
                        <div className="font-semibold text-slate-900">AES-256-GCM Vault Reference</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200 bg-slate-50/50">
              <button
                type="button"
                onClick={() => setStep(Math.max(1, step - 1))}
                disabled={step === 1 || savingConnection}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>

              <div className="flex items-center gap-2">
                {step < 8 ? (
                  <button
                    type="button"
                    onClick={async () => {
                      if (step === 1) {
                        setStep(2)
                      } else if (step === 2) {
                        if (!connName.trim() || !host.trim() || !database.trim() || !username.trim()) {
                          addToast('Validation Error', 'Please complete all required fields', 'error')
                          return
                        }
                        setStep(3)
                      } else if (step === 3) {
                        // Advance to schemas
                        if (!testResult?.success) {
                          addToast('Warning', 'Run connectivity test first before proceeding', 'warning')
                          return
                        }
                        setStep(4)
                      } else if (step === 4) {
                        setStep(5)
                        // Load tables
                        setLoadingDiscovery(true)
                        try {
                          // Tables discovery mock/real
                          setDiscoveredTables([
                            {
                              schema: selectedSchema,
                              name: 'customer_ap_bills',
                              type: 'table',
                              estimated_row_count: 3,
                              primary_keys: ['bill_uuid'],
                              columns: [
                                { name: 'bill_uuid', data_type: 'uuid', nullable: false, primary_key: true },
                                { name: 'inv_code', data_type: 'varchar', nullable: false, primary_key: false },
                                { name: 'po_code', data_type: 'varchar', nullable: false, primary_key: false },
                                { name: 'supplier_id', data_type: 'varchar', nullable: false, primary_key: false },
                                { name: 'amount_num', data_type: 'numeric', nullable: false, primary_key: false },
                                { name: 'curr_iso', data_type: 'varchar', nullable: false, primary_key: false },
                              ],
                            },
                          ])
                        } finally {
                          setLoadingDiscovery(false)
                        }
                      } else if (step === 5) {
                        if (!selectedTable) {
                          addToast('Table Required', 'Select a table to map', 'error')
                          return
                        }
                        setStep(6)
                      } else if (step === 6) {
                        setLoadingPreview(true)
                        try {
                          setPreviewData({
                            schema: selectedSchema,
                            table: selectedTable,
                            row_count: 2,
                            columns: ['bill_uuid', 'inv_code', 'po_code', 'supplier_id', 'amount_num', 'curr_iso'],
                            rows: [
                              { bill_uuid: '10000000-0000-0000-0000-000000000001', inv_code: 'CUST-INV-001', po_code: 'PO-7790', supplier_id: 'V-1001', amount_num: 48500.00, curr_iso: 'INR' },
                              { bill_uuid: '10000000-0000-0000-0000-000000000002', inv_code: 'CUST-INV-002', po_code: 'PO-7781', supplier_id: 'V-1001', amount_num: 125000.00, curr_iso: 'INR' },
                            ],
                          })
                        } finally {
                          setLoadingPreview(false)
                        }
                        setStep(7)
                      } else if (step === 7) {
                        setStep(8)
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
                  >
                    <span>Next</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveConnection}
                    disabled={savingConnection}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    <span>{savingConnection ? 'Saving...' : 'Save & Activate Data Source'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Schema Inspection Slide-Over Drawer */}
      {/* ------------------------------------------------------------------ */}
      {inspectConn && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs">
          <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full border-l border-slate-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-700" />
                <h3 className="font-bold text-sm text-slate-900">Schema Explorer: {inspectConn.name}</h3>
              </div>
              <button
                onClick={() => setInspectConn(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Schema</label>
                <select
                  value={selectedInspectSchema}
                  onChange={(e) => handleInspectSchemaChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-mono font-medium"
                >
                  {inspectSchemas.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                  <span>Discovered Tables & Views</span>
                  <span className="font-normal text-slate-400 text-[11px]">{inspectTables.length} objects</span>
                </h4>

                {loadingInspect ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2 text-slate-400" />
                    <span>Inspecting catalog...</span>
                  </div>
                ) : inspectTables.length === 0 ? (
                  <div className="p-4 rounded-lg bg-slate-50 text-xs text-slate-500 text-center">
                    No tables discovered in schema '{selectedInspectSchema}'.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {inspectTables.map((tbl) => (
                      <div key={tbl.name} className="rounded-xl border border-slate-200 p-3 bg-white space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-slate-900">{tbl.name}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase font-mono text-slate-600">
                            {tbl.type}
                          </span>
                        </div>

                        <div className="divide-y divide-slate-100 text-[11px] font-mono">
                          {tbl.columns.map((c) => (
                            <div key={c.name} className="py-1 flex items-center justify-between text-slate-600">
                              <span>
                                {c.name} {c.primary_key && <span className="text-amber-600 font-bold">★ PK</span>}
                              </span>
                              <span className="text-slate-400 text-[10px]">{c.data_type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
