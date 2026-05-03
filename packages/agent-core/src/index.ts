import type {
  AgentDefinition,
  AgentResult,
  ArtifactWithContent,
  Risk,
  RunInputPayload,
  SkillDefinition,
  WorkflowNode
} from "@agent-studio/shared";

export interface AgentExecutionInput {
  node: WorkflowNode;
  runId: string;
  inputPayload: RunInputPayload;
  previousArtifacts: ArtifactWithContent[];
  agent?: AgentDefinition;
  skills?: SkillDefinition[];
}

export interface AgentProvider {
  readonly kind: string;
  run(input: AgentExecutionInput): Promise<AgentResult>;
}

export class MockAgentProvider implements AgentProvider {
  readonly kind = "mock";

  async run(input: AgentExecutionInput): Promise<AgentResult> {
    await delay(650);

    if (input.node.agentId || input.agent || input.node.outputConfig) {
      return buildConfigDrivenReport(input);
    }

    switch (input.node.id) {
      case "requirement_agent":
        return buildRequirementReport(input);
      case "code_review_agent":
        return buildCodeReviewReport(input);
      case "security_agent":
        return buildSecurityReport(input);
      case "test_agent":
        return buildTestPlan(input);
      case "final_report_agent":
        return buildFinalReport(input);
      default:
        return buildGenericReport(input);
    }
  }
}

export class OpenAIResponsesProvider implements AgentProvider {
  readonly kind = "openai_responses";

  async run(): Promise<AgentResult> {
    throw new Error(
      "OpenAIResponsesProvider is a scaffold for Phase 6. Set AGENT_PROVIDER=mock for the MVP."
    );
  }
}

function buildRequirementReport(input: AgentExecutionInput): AgentResult {
  const source = getReviewSource(input.inputPayload);
  const risks: Risk[] = [
    {
      level: "medium",
      title: "Scope needs reviewer confirmation",
      description: "The mock analyzer found local file inputs that should be matched against product intent."
    }
  ];

  const content = `# Requirements Summary

## Review Source

${source.label}

${input.inputPayload.contextNote ? `## Context\n\n${input.inputPayload.contextNote}\n` : ""}

## Intent

This review is based on ${source.fileNames.length || "the supplied"} local file input(s). The main review question is whether the behavior in these files matches the intended product workflow.

## Local Files

${formatList(source.fileNames.length ? source.fileNames : ["No local files were selected."])}

## Input Size

- Files: ${source.fileCount}
- Text lines: ${source.totalLines}

## Reviewer Questions

- Does the change preserve existing behavior for unchanged callers?
- Are failure paths and empty states covered?
- Does the new behavior need release notes or operator documentation?
`;

  return {
    summary: "Requirements and review questions were extracted from local file inputs.",
    artifacts: [{ name: "requirements_summary.md", type: "markdown", content }],
    risks,
    nextActions: ["Confirm intended behavior with the file owner", "Map selected files to ownership areas"]
  };
}

function buildCodeReviewReport(input: AgentExecutionInput): AgentResult {
  const source = getReviewSource(input.inputPayload);
  const additions = countPrefix(source.diffText, "+");
  const removals = countPrefix(source.diffText, "-");
  const diffSummary = source.diffText
    ? `The optional diff contains ${additions} added line(s) and ${removals} removed line(s).`
    : `The mock reviewer inspected ${source.fileCount} local file(s) with ${source.totalLines} total line(s).`;
  const content = `# Code Review Report

## Summary

${diffSummary}

## Findings

- Keep data transformations explicit and easy to test.
- Confirm that existing callers still receive compatible return shapes.
- Add focused tests around changed branches rather than broad snapshot-only coverage.

## Maintainability Notes

The change is suitable for review once the tests named in the test plan are added or confirmed.
`;

  return {
    summary: "Code review report generated with deterministic mock findings.",
    artifacts: [{ name: "code_review_report.md", type: "markdown", content }],
    risks: [
      {
        level: "medium",
        title: "Regression coverage may be thin",
        description: "The selected local files should be accompanied by tests for changed branches and compatibility behavior."
      }
    ],
    nextActions: ["Add targeted branch coverage", "Check compatibility with existing callers"]
  };
}

function buildSecurityReport(input: AgentExecutionInput): AgentResult {
  const source = getReviewSource(input.inputPayload);
  const mentionsSensitiveWords = /token|secret|password|auth|permission|role/i.test(source.sourceText);
  const content = `# Security Report

## Assessment

${mentionsSensitiveWords ? "The selected files reference security-sensitive concepts and should receive careful review." : "No obvious security-sensitive keywords were detected in the selected local files."}

## Checks

- Authorization boundaries remain explicit.
- User-controlled input should be validated before persistence or execution.
- Secrets and tokens should not be logged or returned in artifacts.

## Recommendation

${mentionsSensitiveWords ? "Request a security-focused reviewer before merging." : "Proceed with standard review, while keeping the checklist above visible."}
`;

  return {
    summary: "Security review completed using keyword and checklist-based mock logic.",
    artifacts: [{ name: "security_report.md", type: "markdown", content }],
    risks: [
      {
        level: mentionsSensitiveWords ? "high" : "low",
        title: mentionsSensitiveWords ? "Security-sensitive diff content" : "No immediate security keyword signal",
        description: mentionsSensitiveWords
          ? "The selected files mention sensitive concepts such as auth, token, role, or permission."
          : "The selected files do not contain obvious sensitive keywords, but still require normal review."
      }
    ],
    nextActions: mentionsSensitiveWords
      ? ["Ask a security reviewer to inspect the change", "Confirm no secrets are persisted or logged"]
      : ["Run the standard review checklist"]
  };
}

function buildTestPlan(input: AgentExecutionInput): AgentResult {
  const source = getReviewSource(input.inputPayload);
  const content = `# Test Plan

## Unit Tests

- Add tests for changed branches in ${source.fileNames[0] ?? "the primary selected module"}.
- Cover empty, invalid, and happy-path inputs.

## Integration Tests

- Verify the workflow that consumes the changed behavior.
- Confirm persisted or returned shapes remain compatible.

## Manual Verification

- Run the feature path with representative review data.
- Confirm logs and generated artifacts do not include sensitive values.
- Re-run this workflow with the same file set after local changes are saved.
`;

  return {
    summary: "Test plan generated for unit, integration, and manual verification.",
    artifacts: [{ name: "test_plan.md", type: "markdown", content }],
    risks: [
      {
        level: "medium",
        title: "Manual verification still required",
        description: "Mock analysis cannot prove runtime behavior; a reviewer should run the affected workflow."
      }
    ],
    nextActions: ["Run targeted unit tests", "Complete one manual smoke test"]
  };
}

function buildFinalReport(input: AgentExecutionInput): AgentResult {
  const source = getReviewSource(input.inputPayload);
  const sections = input.previousArtifacts
    .map((artifact) => `## ${artifact.name}\n\n${trimMarkdown(artifact.content)}`)
    .join("\n\n");

  const content = `# Final Review Report

## Status

Approved for follow-up review after human confirmation.

## Review Source

${source.label}

## Files Reviewed

${formatList(source.fileNames.length ? source.fileNames : ["No local files were selected."])}

## Consolidated Artifacts

${sections || "No previous artifacts were available."}

## Final Recommendation

Proceed once the reviewer confirms the test plan and any medium or high risks are either fixed or accepted.
`;

  return {
    summary: "Final review report generated from prior artifacts.",
    artifacts: [{ name: "final_review_report.md", type: "markdown", content }],
    risks: [],
    nextActions: ["Share final report with the reviewer", "Archive artifacts with the workflow run"]
  };
}

function buildGenericReport(input: AgentExecutionInput): AgentResult {
  const outputName = input.node.outputs?.[0] ?? `${input.node.id}.md`;
  const content = `# ${input.node.name}

Mock execution completed for node \`${input.node.id}\`.
`;

  return {
    summary: `Mock execution completed for ${input.node.name}.`,
    artifacts: [{ name: outputName, type: "markdown", content }],
    risks: [],
    nextActions: []
  };
}

function buildConfigDrivenReport(input: AgentExecutionInput): AgentResult {
  const source = getReviewSource(input.inputPayload);
  const agentName = input.agent?.name ?? input.node.name;
  const prompt = input.agent?.systemPrompt ?? input.node.prompt ?? "Analyze the workflow input.";
  const skillList = input.skills?.filter((skill) => skill.enabled).map((skill) => skill.name) ?? [];
  const formats = input.node.outputConfig?.formats.length
    ? input.node.outputConfig.formats
    : input.agent?.outputFormats?.length
      ? input.agent.outputFormats
      : ["markdown" as const];
  const baseName = input.node.outputConfig?.artifactName || input.node.outputs?.[0]?.replace(/\.[^.]+$/, "") || input.node.id;
  const markdown = `# ${agentName}

## Summary

Mock execution completed for ${input.node.name}. The agent reviewed ${source.fileCount} local file(s) and ${source.totalLines} line(s).

## Prompt

${prompt}

## Skills

${formatList(skillList.length ? skillList : ["No skills attached."])}

## Inputs

${formatList(source.fileNames.length ? source.fileNames : ["No local files were selected."])}

## Result

This artifact is generated from the custom workflow builder and is ready for downstream output nodes.
`;

  return {
    summary: `Config-driven mock execution completed for ${agentName}.`,
    artifacts: formats.map((format) => ({
      name: artifactNameFor(baseName, format),
      type: format,
      content: format === "json"
        ? JSON.stringify({ agent: agentName, files: source.fileNames, summary: "Mock execution completed." }, null, 2)
        : markdown
    })),
    risks: [],
    nextActions: ["Review generated artifacts", "Continue to the output node"]
  };
}

function artifactNameFor(baseName: string, format: "markdown" | "html" | "pdf" | "json" | "text"): string {
  const extension = format === "markdown" ? "md" : format;
  const safeBase = baseName.replace(/\.[^.]+$/, "") || "artifact";
  return `${safeBase}.${extension}`;
}

function extractChangedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match?.[2]) {
      files.add(match[2]);
    }
  }
  return [...files];
}

function getReviewSource(input: RunInputPayload): {
  label: string;
  fileCount: number;
  fileNames: string[];
  totalLines: number;
  sourceText: string;
  diffText: string;
} {
  const files = input.files ?? [];
  const fileNames = files.map((file) => file.relativePath || file.name);
  const diffText = input.prDiff ?? "";
  const fallbackNames = diffText ? extractChangedFiles(diffText) : [];
  const sourceText = files.length
    ? files
        .map((file) => `===== ${file.relativePath || file.name} =====\n${file.content}`)
        .join("\n\n")
    : diffText;
  const totalLines = sourceText ? sourceText.split(/\r?\n/).length : 0;

  return {
    label: input.sourceLabel || input.prUrl || "Local file review",
    fileCount: files.length,
    fileNames: fileNames.length ? fileNames : fallbackNames,
    totalLines,
    sourceText,
    diffText
  };
}

function countPrefix(diff: string, prefix: string): number {
  return diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`)).length;
}

function formatList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function trimMarkdown(content: string): string {
  return content.trim().replace(/^# .+$/m, "").trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
