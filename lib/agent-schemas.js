import { z } from 'zod';

export const IntakeSchema = z.object({
  sprintGoal: z.string().max(500), startDate: z.string(), endDate: z.string(),
  workItems: z.array(z.object({ id: z.string().max(80), text: z.string().max(600), priority: z.number().int().min(1).default(3), mandatory: z.boolean().default(false) })).max(30),
  exclusions: z.array(z.string().max(300)).max(20).default([]), constraints: z.array(z.string().max(300)).max(20).default([]),
  clarifications: z.array(z.string().max(300)).max(8).default([]), goalSuggestion: z.string().max(500).nullable().default(null)
});
export const DecompositionSchema = z.object({ items: z.array(z.object({
  id: z.string().max(80), sourceText: z.string().max(600), summary: z.string().max(180), description: z.string().max(800),
  acceptanceCriteria: z.array(z.string().max(360)).max(5).default([]), issueType: z.string().max(60).default('Task'),
  dependencyIds: z.array(z.string().max(80)).max(15).default([]), priority: z.number().int().min(1).default(3),
  mandatory: z.boolean().default(false), needsPOReview: z.boolean().default(false),
  skillsNeeded: z.array(z.string().max(80)).max(8).default([]),
  subtasks: z.array(z.object({ summary: z.string().max(180), description: z.string().max(350).default(''), acceptanceCriteria: z.array(z.string().max(240)).max(3).default([]), skillsNeeded: z.array(z.string().max(80)).max(8).default([]), issueType: z.string().max(60).default('Sub-task') })).max(3).default([])
})).max(15) });
export const PlanningSchema = z.object({
  recommendedCandidateId: z.string().max(120),
  candidates: z.array(z.object({ id: z.string(), name: z.string(), selectedItemIds: z.array(z.string()),
    sequence: z.array(z.string()), deferredItemIds: z.array(z.string()).default([]),
    rationale: z.string().max(400), tradeoffs: z.array(z.string().max(240)).max(3).default([]) })).min(1).max(2)
});
export const PredictionSchema = z.object({ estimates: z.array(z.object({
  itemId: z.string(), low: z.number().nullable(), high: z.number().nullable(), unit: z.string().nullable(),
  successProbability: z.number().min(0).max(100).nullable(), riskLevel: z.enum(['low','medium','high','unknown']), resourceNeeds: z.array(z.string().max(120)).max(5),
  confidence: z.enum(['high','medium','low','unknown']), basis: z.string().max(300), risks: z.array(z.string().max(240)).max(4).default([])
})).max(20), teamCapacitySummary: z.string().max(600), overallRisks: z.array(z.string().max(300)).max(8).default([]) });
export const AssignmentSchema = z.object({ assignments: z.array(z.object({
  itemId: z.string(), memberId: z.string().nullable(), rationale: z.string().max(300),
  evidence: z.array(z.string().max(180)).max(4).default([]), confidence: z.enum(['high','medium','low','unknown'])
})).max(20) });
export const MonitorSchema = z.object({ findings: z.array(z.object({
  id: z.string(), severity: z.enum(['blocker','warning','question']), category: z.string(),
  itemId: z.string().nullable(), summary: z.string().max(360), action: z.string().max(360)
})).max(20), statusReport: z.string().max(500), reportingCadence: z.string().max(100).nullable(), taskProgress: z.array(z.object({ task: z.string().max(180), status: z.string().max(100), evidence: z.string().max(240) })).max(15), kpiTracking: z.array(z.object({ metric: z.string().max(120), currentValue: z.string().max(80).nullable(), target: z.string().max(80).nullable(), source: z.string().max(160), cadence: z.string().max(100) })).max(8), deviationAlerts: z.array(z.string().max(240)).max(8) });
export const EvaluationSchema = z.object({
  overallAssessment: z.string().max(500),
  goalAlignment: z.string().max(360),
  usabilityScore: z.number().min(0).max(100).nullable(),
  usabilityChecks: z.array(z.object({ criterion: z.string().max(180), status: z.enum(['met','gap','not_evidenced']), evidence: z.string().max(300) })).max(8),
  metrics: z.array(z.object({ name: z.string().max(120), baseline: z.string().max(80).nullable(), postEnhancement: z.string().max(80).nullable(), improvement: z.string().max(80).nullable(), source: z.string().max(200) })).max(8),
  findings: z.array(z.object({ severity: z.enum(['blocker','warning','note']), summary: z.string().max(300), action: z.string().max(300) })).max(8)
});
export const OrchestratorSchema = z.object({
  status: z.enum(['ready_for_review','needs_attention']), summary: z.string().max(1000),
  unresolvedQuestions: z.array(z.string().max(300)).max(8).default([]), revisionSummary: z.array(z.string().max(300)).max(8).default([])
});
