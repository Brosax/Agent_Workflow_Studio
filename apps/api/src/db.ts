import { DatabaseSync } from "node:sqlite";
import type {
  AgentDefinition,
  Approval,
  ApprovalStatus,
  Artifact,
  CliChatMessage,
  CliChatRole,
  CliChatSession,
  CliChatStatus,
  CreateAgentRequest,
  CreateSkillRequest,
  SkillDefinition,
  NodeRun,
  NodeRunStatus,
  RunEvent,
  RunEventType,
  RunInputPayload,
  UpdateAgentRequest,
  UpdateSkillRequest,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSummary
} from "@agent-studio/shared";

export class StudioDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.initialize();
  }

  createRun(args: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    inputPayload: RunInputPayload;
    startedBy: string;
    startedAt: string;
  }): WorkflowRun {
    this.db
      .prepare(
        `insert into workflow_runs
         (id, workflow_id, workflow_version, status, input_payload, started_by, started_at)
         values (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        args.id,
        args.workflowId,
        args.workflowVersion,
        "running",
        JSON.stringify(args.inputPayload),
        args.startedBy,
        args.startedAt
      );

    return this.getRun(args.id);
  }

  createNodeRuns(runId: string, nodes: WorkflowNode[]): NodeRun[] {
    const statement = this.db.prepare(
      `insert into node_runs
       (id, workflow_run_id, node_id, node_name, node_type, status)
       values (?, ?, ?, ?, ?, ?)`
    );

    for (const node of nodes) {
      statement.run(crypto.randomUUID(), runId, node.id, node.name, node.type, "pending");
    }

    return this.listNodeRuns(runId);
  }

  getRun(runId: string): WorkflowRun {
    const row = this.db.prepare("select * from workflow_runs where id = ?").get(runId);
    if (!row) {
      throw new Error(`Run not found: ${runId}`);
    }
    return mapRun(row);
  }

  listNodeRuns(runId: string): NodeRun[] {
    return this.db
      .prepare("select * from node_runs where workflow_run_id = ? order by rowid asc")
      .all(runId)
      .map(mapNodeRun);
  }

  getNodeRun(runId: string, nodeId: string): NodeRun {
    const row = this.db
      .prepare("select * from node_runs where workflow_run_id = ? and node_id = ?")
      .get(runId, nodeId);
    if (!row) {
      throw new Error(`Node run not found for ${nodeId} in ${runId}`);
    }
    return mapNodeRun(row);
  }

  updateRunStatus(runId: string, status: WorkflowRunStatus, errorMessage?: string): WorkflowRun {
    const finishedAt = ["completed", "failed", "cancelled"].includes(status) ? new Date().toISOString() : undefined;
    this.db
      .prepare("update workflow_runs set status = ?, finished_at = ?, error_message = ? where id = ?")
      .run(status, finishedAt ?? null, errorMessage ?? null, runId);
    return this.getRun(runId);
  }

  updateNodeStatus(
    nodeRunId: string,
    status: NodeRunStatus,
    errorMessage?: string
  ): NodeRun {
    const startedAt = status === "running" || status === "waiting_approval" ? new Date().toISOString() : undefined;
    const finishedAt = ["succeeded", "failed", "skipped"].includes(status) ? new Date().toISOString() : undefined;
    this.db
      .prepare(
        `update node_runs
         set status = ?,
             started_at = coalesce(started_at, ?),
             finished_at = ?,
             error_message = ?
         where id = ?`
      )
      .run(status, startedAt ?? null, finishedAt ?? null, errorMessage ?? null, nodeRunId);

    const row = this.db.prepare("select * from node_runs where id = ?").get(nodeRunId);
    if (!row) {
      throw new Error(`Node run not found: ${nodeRunId}`);
    }
    return mapNodeRun(row);
  }

  createArtifact(args: Omit<Artifact, "createdAt"> & { createdAt?: string }): Artifact {
    const createdAt = args.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `insert into artifacts
         (id, workflow_run_id, node_run_id, node_id, name, type, version, content_path, created_by, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        args.id,
        args.workflowRunId,
        args.nodeRunId,
        args.nodeId,
        args.name,
        args.type,
        args.version,
        args.contentPath,
        args.createdBy,
        createdAt
      );
    return this.getArtifact(args.id);
  }

  listArtifacts(runId: string): Artifact[] {
    return this.db
      .prepare("select * from artifacts where workflow_run_id = ? order by created_at asc")
      .all(runId)
      .map(mapArtifact);
  }

  listArtifactsForNode(runId: string, nodeId: string): Artifact[] {
    return this.db
      .prepare("select * from artifacts where workflow_run_id = ? and node_id = ? order by created_at asc")
      .all(runId, nodeId)
      .map(mapArtifact);
  }

  getArtifact(artifactId: string): Artifact {
    const row = this.db.prepare("select * from artifacts where id = ?").get(artifactId);
    if (!row) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    return mapArtifact(row);
  }

  nextArtifactVersion(runId: string, name: string): number {
    const row = this.db
      .prepare("select max(version) as version from artifacts where workflow_run_id = ? and name = ?")
      .get(runId, name);
    return Number(row?.version ?? 0) + 1;
  }

  createApproval(args: {
    id: string;
    workflowRunId: string;
    nodeRunId: string;
    requestedBy: string;
    createdAt?: string;
  }): Approval {
    const createdAt = args.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `insert into approvals
         (id, workflow_run_id, node_run_id, status, requested_by, created_at)
         values (?, ?, ?, ?, ?, ?)`
      )
      .run(args.id, args.workflowRunId, args.nodeRunId, "pending", args.requestedBy, createdAt);
    return this.getApproval(args.id);
  }

  listApprovals(runId: string): Approval[] {
    return this.db
      .prepare("select * from approvals where workflow_run_id = ? order by created_at asc")
      .all(runId)
      .map(mapApproval);
  }

  getPendingApproval(runId: string): Approval | undefined {
    const row = this.db
      .prepare("select * from approvals where workflow_run_id = ? and status = ? order by created_at desc limit 1")
      .get(runId, "pending");
    return row ? mapApproval(row) : undefined;
  }

  getApproval(approvalId: string): Approval {
    const row = this.db.prepare("select * from approvals where id = ?").get(approvalId);
    if (!row) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    return mapApproval(row);
  }

  resolveApproval(approvalId: string, status: ApprovalStatus, comment: string | undefined): Approval {
    this.db
      .prepare(
        `update approvals
         set status = ?, approved_by = ?, comment = ?, resolved_at = ?
         where id = ?`
      )
      .run(status, "local-reviewer", comment ?? null, new Date().toISOString(), approvalId);
    return this.getApproval(approvalId);
  }

  createEvent(args: {
    workflowRunId: string;
    nodeId?: string;
    type: RunEventType;
    message: string;
    payload?: Record<string, unknown>;
  }): RunEvent {
    const event: RunEvent = {
      id: crypto.randomUUID(),
      workflowRunId: args.workflowRunId,
      nodeId: args.nodeId,
      type: args.type,
      message: args.message,
      payload: args.payload,
      createdAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `insert into run_events
         (id, workflow_run_id, node_id, type, message, payload, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.workflowRunId,
        event.nodeId ?? null,
        event.type,
        event.message,
        JSON.stringify(event.payload ?? {}),
        event.createdAt
      );

    return event;
  }

  listEvents(runId: string): RunEvent[] {
    return this.db
      .prepare("select * from run_events where workflow_run_id = ? order by created_at asc")
      .all(runId)
      .map(mapEvent);
  }

  hasWorkflows(): boolean {
    const row = this.db.prepare("select count(*) as count from workflows").get();
    return Number(row?.count ?? 0) > 0;
  }

  upsertWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
    const now = new Date().toISOString();
    const existing = this.db.prepare("select created_at from workflows where id = ?").get(workflow.id);
    const createdAt = nullableString(existing?.created_at) ?? workflow.createdAt ?? now;
    const normalized = normalizeWorkflow({ ...workflow, createdAt, updatedAt: now });

    this.db
      .prepare(
        `insert into workflows
         (id, name, description, version, status, template, created_at, updated_at, definition_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           name = excluded.name,
           description = excluded.description,
           version = excluded.version,
           status = excluded.status,
           template = excluded.template,
           updated_at = excluded.updated_at,
           definition_json = excluded.definition_json`
      )
      .run(
        normalized.id,
        normalized.name,
        normalized.description,
        normalized.version,
        normalized.status ?? "active",
        normalized.template ? 1 : 0,
        normalized.createdAt,
        normalized.updatedAt,
        JSON.stringify(normalized)
      );

    this.replaceWorkflowNodes(normalized);
    return this.getWorkflow(normalized.id);
  }

  createWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
    if (this.db.prepare("select id from workflows where id = ?").get(workflow.id)) {
      throw new Error(`Workflow already exists: ${workflow.id}`);
    }
    return this.upsertWorkflow(workflow);
  }

  getWorkflow(workflowId: string): WorkflowDefinition {
    const row = this.db.prepare("select definition_json from workflows where id = ?").get(workflowId);
    if (!row) {
      throw new Error(`Unknown workflow id: ${workflowId}`);
    }
    return JSON.parse(String(row.definition_json)) as WorkflowDefinition;
  }

  listWorkflows(): WorkflowSummary[] {
    return this.db
      .prepare("select * from workflows order by updated_at desc")
      .all()
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        description: String(row.description),
        version: Number(row.version),
        nodeCount: this.getWorkflow(String(row.id)).nodes.length,
        status: String(row.status) as WorkflowSummary["status"],
        template: Boolean(row.template),
        updatedAt: String(row.updated_at)
      }));
  }

  deleteWorkflow(workflowId: string): void {
    this.db.prepare("delete from workflow_nodes where workflow_id = ?").run(workflowId);
    this.db.prepare("delete from workflows where id = ?").run(workflowId);
  }

  listRecentRuns(limit = 8): WorkflowRun[] {
    return this.db
      .prepare("select * from workflow_runs order by started_at desc limit ?")
      .all(limit)
      .map(mapRun);
  }

  createAgent(request: CreateAgentRequest): AgentDefinition {
    const now = new Date().toISOString();
    const agent: AgentDefinition = {
      id: crypto.randomUUID(),
      name: request.name,
      description: request.description ?? "",
      provider: request.provider ?? "mock",
      model: request.model ?? "mock-agent",
      systemPrompt: request.systemPrompt ?? "Analyze the workflow input and produce a useful artifact.",
      outputFormats: request.outputFormats?.length ? request.outputFormats : ["markdown"],
      skillIds: request.skillIds ?? [],
      enabled: request.enabled ?? true,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `insert into agents
         (id, name, description, provider, model, system_prompt, output_formats, skill_ids, enabled, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent.id,
        agent.name,
        agent.description,
        agent.provider,
        agent.model,
        agent.systemPrompt,
        JSON.stringify(agent.outputFormats),
        JSON.stringify(agent.skillIds),
        agent.enabled ? 1 : 0,
        agent.createdAt,
        agent.updatedAt
      );
    return this.getAgent(agent.id);
  }

  updateAgent(agentId: string, request: UpdateAgentRequest): AgentDefinition {
    const current = this.getAgent(agentId);
    const next: AgentDefinition = {
      ...current,
      name: request.name ?? current.name,
      description: request.description ?? current.description,
      provider: request.provider ?? current.provider,
      model: request.model ?? current.model,
      systemPrompt: request.systemPrompt ?? current.systemPrompt,
      outputFormats: request.outputFormats?.length ? request.outputFormats : current.outputFormats,
      skillIds: request.skillIds ?? current.skillIds,
      enabled: request.enabled ?? current.enabled,
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `update agents
         set name = ?, description = ?, provider = ?, model = ?, system_prompt = ?,
             output_formats = ?, skill_ids = ?, enabled = ?, updated_at = ?
         where id = ?`
      )
      .run(
        next.name,
        next.description,
        next.provider,
        next.model,
        next.systemPrompt,
        JSON.stringify(next.outputFormats),
        JSON.stringify(next.skillIds),
        next.enabled ? 1 : 0,
        next.updatedAt,
        agentId
      );
    return this.getAgent(agentId);
  }

  listAgents(): AgentDefinition[] {
    return this.db.prepare("select * from agents order by updated_at desc").all().map(mapAgent);
  }

  getAgent(agentId: string): AgentDefinition {
    const row = this.db.prepare("select * from agents where id = ?").get(agentId);
    if (!row) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return mapAgent(row);
  }

  getAgentOptional(agentId: string | undefined): AgentDefinition | undefined {
    if (!agentId) {
      return undefined;
    }
    const row = this.db.prepare("select * from agents where id = ?").get(agentId);
    return row ? mapAgent(row) : undefined;
  }

  deleteAgent(agentId: string): void {
    this.db.prepare("delete from agents where id = ?").run(agentId);
  }

  createSkill(request: CreateSkillRequest): SkillDefinition {
    const now = new Date().toISOString();
    const skill: SkillDefinition = {
      id: crypto.randomUUID(),
      name: request.name,
      description: request.description ?? "",
      content: request.content ?? "",
      sourcePath: request.sourcePath,
      enabled: request.enabled ?? true,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `insert into skills
         (id, name, description, content, source_path, enabled, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        skill.id,
        skill.name,
        skill.description,
        skill.content,
        skill.sourcePath ?? null,
        skill.enabled ? 1 : 0,
        skill.createdAt,
        skill.updatedAt
      );
    return this.getSkill(skill.id);
  }

  upsertSkillBySourcePath(request: CreateSkillRequest): SkillDefinition {
    const row = request.sourcePath
      ? this.db.prepare("select id from skills where source_path = ?").get(request.sourcePath)
      : undefined;
    return row ? this.updateSkill(String(row.id), request) : this.createSkill(request);
  }

  updateSkill(skillId: string, request: UpdateSkillRequest): SkillDefinition {
    const current = this.getSkill(skillId);
    const next: SkillDefinition = {
      ...current,
      name: request.name ?? current.name,
      description: request.description ?? current.description,
      content: request.content ?? current.content,
      sourcePath: request.sourcePath ?? current.sourcePath,
      enabled: request.enabled ?? current.enabled,
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `update skills
         set name = ?, description = ?, content = ?, source_path = ?, enabled = ?, updated_at = ?
         where id = ?`
      )
      .run(next.name, next.description, next.content, next.sourcePath ?? null, next.enabled ? 1 : 0, next.updatedAt, skillId);
    return this.getSkill(skillId);
  }

  listSkills(): SkillDefinition[] {
    return this.db.prepare("select * from skills order by updated_at desc").all().map(mapSkill);
  }

  listSkillsByIds(skillIds: string[] | undefined): SkillDefinition[] {
    if (!skillIds?.length) {
      return [];
    }
    const all = new Map(this.listSkills().map((skill) => [skill.id, skill]));
    return skillIds.map((skillId) => all.get(skillId)).filter((skill): skill is SkillDefinition => Boolean(skill));
  }

  getSkill(skillId: string): SkillDefinition {
    const row = this.db.prepare("select * from skills where id = ?").get(skillId);
    if (!row) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    return mapSkill(row);
  }

  deleteSkill(skillId: string): void {
    this.db.prepare("delete from skills where id = ?").run(skillId);
  }

  private replaceWorkflowNodes(workflow: WorkflowDefinition): void {
    this.db.prepare("delete from workflow_nodes where workflow_id = ?").run(workflow.id);
    const statement = this.db.prepare(
      `insert into workflow_nodes (workflow_id, node_id, node_type, node_json)
       values (?, ?, ?, ?)`
    );
    for (const node of workflow.nodes) {
      statement.run(workflow.id, node.id, node.type, JSON.stringify(node));
    }
  }

  createCliSession(args?: { id?: string; createdAt?: string; metadata?: Record<string, unknown> }): CliChatSession {
    const now = args?.createdAt ?? new Date().toISOString();
    const id = args?.id ?? crypto.randomUUID();

    this.db
      .prepare(
        `insert into cli_sessions
         (id, status, created_at, updated_at, last_error, metadata)
         values (?, ?, ?, ?, ?, ?)`
      )
      .run(id, "idle", now, now, null, JSON.stringify(args?.metadata ?? {}));

    return this.getCliSession(id);
  }

  getCliSession(sessionId: string): CliChatSession {
    const row = this.db.prepare("select * from cli_sessions where id = ?").get(sessionId);
    if (!row) {
      throw new Error(`CLI chat session not found: ${sessionId}`);
    }
    return mapCliSession(row);
  }

  updateCliSessionStatus(sessionId: string, status: CliChatStatus, lastError?: string): CliChatSession {
    this.db
      .prepare(
        `update cli_sessions
         set status = ?, updated_at = ?, last_error = ?
         where id = ?`
      )
      .run(status, new Date().toISOString(), lastError ?? null, sessionId);
    return this.getCliSession(sessionId);
  }

  createCliMessage(args: {
    id?: string;
    sessionId: string;
    role: CliChatRole;
    content: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }): CliChatMessage {
    const id = args.id ?? crypto.randomUUID();
    const createdAt = args.createdAt ?? new Date().toISOString();

    this.db
      .prepare(
        `insert into cli_messages
         (id, session_id, role, content, created_at, metadata)
         values (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        args.sessionId,
        args.role,
        args.content,
        createdAt,
        JSON.stringify(args.metadata ?? {})
      );

    return this.getCliMessage(id);
  }

  getCliMessage(messageId: string): CliChatMessage {
    const row = this.db.prepare("select * from cli_messages where id = ?").get(messageId);
    if (!row) {
      throw new Error(`CLI chat message not found: ${messageId}`);
    }
    return mapCliMessage(row);
  }

  appendCliMessageContent(messageId: string, chunk: string): CliChatMessage {
    this.db
      .prepare(
        `update cli_messages
         set content = content || ?
         where id = ?`
      )
      .run(chunk, messageId);
    return this.getCliMessage(messageId);
  }

  replaceCliMessageContent(messageId: string, content: string): CliChatMessage {
    this.db
      .prepare("update cli_messages set content = ? where id = ?")
      .run(content, messageId);
    return this.getCliMessage(messageId);
  }

  listCliMessages(sessionId: string): CliChatMessage[] {
    return this.db
      .prepare("select * from cli_messages where session_id = ? order by created_at asc, rowid asc")
      .all(sessionId)
      .map(mapCliMessage);
  }

  private initialize(): void {
    this.db.exec(`
      pragma journal_mode = WAL;

      create table if not exists workflow_runs (
        id text primary key,
        workflow_id text not null,
        workflow_version integer not null,
        status text not null,
        input_payload text not null,
        started_by text not null,
        started_at text not null,
        finished_at text,
        error_message text
      );

      create table if not exists workflows (
        id text primary key,
        name text not null,
        description text not null,
        version integer not null,
        status text not null,
        template integer not null default 0,
        created_at text not null,
        updated_at text not null,
        definition_json text not null
      );

      create table if not exists workflow_nodes (
        workflow_id text not null,
        node_id text not null,
        node_type text not null,
        node_json text not null,
        primary key (workflow_id, node_id)
      );

      create table if not exists agents (
        id text primary key,
        name text not null,
        description text not null,
        provider text not null,
        model text not null,
        system_prompt text not null,
        output_formats text not null,
        skill_ids text not null,
        enabled integer not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists skills (
        id text primary key,
        name text not null,
        description text not null,
        content text not null,
        source_path text,
        enabled integer not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists node_runs (
        id text primary key,
        workflow_run_id text not null,
        node_id text not null,
        node_name text not null,
        node_type text not null,
        status text not null,
        started_at text,
        finished_at text,
        error_message text
      );

      create table if not exists artifacts (
        id text primary key,
        workflow_run_id text not null,
        node_run_id text not null,
        node_id text not null,
        name text not null,
        type text not null,
        version integer not null,
        content_path text not null,
        created_by text not null,
        created_at text not null
      );

      create table if not exists approvals (
        id text primary key,
        workflow_run_id text not null,
        node_run_id text not null,
        status text not null,
        requested_by text not null,
        approved_by text,
        comment text,
        created_at text not null,
        resolved_at text
      );

      create table if not exists run_events (
        id text primary key,
        workflow_run_id text not null,
        node_id text,
        type text not null,
        message text not null,
        payload text,
        created_at text not null
      );

      create table if not exists cli_sessions (
        id text primary key,
        status text not null,
        created_at text not null,
        updated_at text not null,
        last_error text,
        metadata text
      );

      create table if not exists cli_messages (
        id text primary key,
        session_id text not null,
        role text not null,
        content text not null,
        created_at text not null,
        metadata text
      );
    `);
  }
}

function mapRun(row: Record<string, unknown>): WorkflowRun {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowVersion: Number(row.workflow_version),
    status: row.status as WorkflowRunStatus,
    inputPayload: JSON.parse(String(row.input_payload)) as RunInputPayload,
    startedBy: String(row.started_by),
    startedAt: String(row.started_at),
    finishedAt: nullableString(row.finished_at),
    errorMessage: nullableString(row.error_message)
  };
}

function mapNodeRun(row: Record<string, unknown>): NodeRun {
  return {
    id: String(row.id),
    workflowRunId: String(row.workflow_run_id),
    nodeId: String(row.node_id),
    nodeName: String(row.node_name),
    nodeType: row.node_type as NodeRun["nodeType"],
    status: row.status as NodeRunStatus,
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    errorMessage: nullableString(row.error_message)
  };
}

function mapArtifact(row: Record<string, unknown>): Artifact {
  return {
    id: String(row.id),
    workflowRunId: String(row.workflow_run_id),
    nodeRunId: String(row.node_run_id),
    nodeId: String(row.node_id),
    name: String(row.name),
    type: row.type as Artifact["type"],
    version: Number(row.version),
    contentPath: String(row.content_path),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at)
  };
}

function mapApproval(row: Record<string, unknown>): Approval {
  return {
    id: String(row.id),
    workflowRunId: String(row.workflow_run_id),
    nodeRunId: String(row.node_run_id),
    status: row.status as ApprovalStatus,
    requestedBy: String(row.requested_by),
    approvedBy: nullableString(row.approved_by),
    comment: nullableString(row.comment),
    createdAt: String(row.created_at),
    resolvedAt: nullableString(row.resolved_at)
  };
}

function mapEvent(row: Record<string, unknown>): RunEvent {
  return {
    id: String(row.id),
    workflowRunId: String(row.workflow_run_id),
    nodeId: nullableString(row.node_id),
    type: row.type as RunEventType,
    message: String(row.message),
    payload: row.payload ? (JSON.parse(String(row.payload)) as Record<string, unknown>) : undefined,
    createdAt: String(row.created_at)
  };
}

function mapAgent(row: Record<string, unknown>): AgentDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    provider: row.provider as AgentDefinition["provider"],
    model: String(row.model),
    systemPrompt: String(row.system_prompt),
    outputFormats: JSON.parse(String(row.output_formats)) as AgentDefinition["outputFormats"],
    skillIds: JSON.parse(String(row.skill_ids)) as string[],
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSkill(row: Record<string, unknown>): SkillDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    content: String(row.content),
    sourcePath: nullableString(row.source_path),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapCliSession(row: Record<string, unknown>): CliChatSession {
  return {
    id: String(row.id),
    status: row.status as CliChatStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastError: nullableString(row.last_error)
  };
}

function mapCliMessage(row: Record<string, unknown>): CliChatMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role as CliChatRole,
    content: String(row.content),
    createdAt: String(row.created_at),
    metadata: row.metadata ? (JSON.parse(String(row.metadata)) as Record<string, unknown>) : undefined
  };
}

function normalizeWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const now = new Date().toISOString();
  return {
    ...workflow,
    status: workflow.status ?? "active",
    template: workflow.template ?? false,
    createdAt: workflow.createdAt ?? now,
    updatedAt: workflow.updatedAt ?? now,
    inputs: workflow.inputs ?? {},
    nodes: workflow.nodes.map((node, index) => ({
      ...node,
      position: node.position ?? { x: 260 + index * 280, y: index === 0 ? 80 : 220 }
    }))
  };
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
