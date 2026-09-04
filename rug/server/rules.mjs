function getPath(root, dotted) {
  if (!dotted) return undefined;
  return String(dotted).split('.').reduce((value, key) => value == null ? undefined : value[key], root);
}

export function evaluateCondition(state, condition) {
  const actual = getPath(state, condition.path);
  const op = condition.op || 'eq';
  let met = false;
  switch (op) {
    case 'exists': met = actual !== undefined && actual !== null; break;
    case 'not_exists': met = actual === undefined || actual === null; break;
    case 'eq': met = actual === condition.value; break;
    case 'neq': met = actual !== condition.value; break;
    case 'gte': met = Number(actual) >= Number(condition.value); break;
    case 'lte': met = Number(actual) <= Number(condition.value); break;
    case 'contains': met = Array.isArray(actual) ? actual.includes(condition.value) : String(actual ?? '').includes(String(condition.value)); break;
    default: throw new Error(`Unknown victory operator: ${op}`);
  }
  return { ...condition, actual, met };
}

export function evaluateMissions(state) {
  const result = {};
  for (const mission of Object.values(state.missions || {})) {
    const conditions = mission.success_conditions || [];
    const checks = conditions.map(c => evaluateCondition(state, c));
    const met = checks.filter(c => c.met).length;
    result[mission.id] = {
      mission_id: mission.id,
      met,
      total: checks.length,
      won: checks.length > 0 && met === checks.length,
      checks
    };
  }
  return result;
}
