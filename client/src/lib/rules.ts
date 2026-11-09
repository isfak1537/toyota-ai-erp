// The anomaly rules (AI-008) in plain words. The codes come from the AI service.
const RULE_LABEL: Record<string, string> = {
  R1: 'Large negative adjustment',
  R2: 'Quantity far above normal',
  R3: 'Outside business hours',
  R4: 'Large manual receipt',
  R5: 'Duplicate movement',
}

export const ruleLabel = (code: string) => RULE_LABEL[code] ?? code
