export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function ensure(condition, status, message) { if (!condition) throw new AppError(status, message); }
export function userId(value) {
  const s = String(value ?? '');
  ensure(/^[1-9]\d{0,15}$/.test(s) && Number.isSafeInteger(Number(s)), 400, 'Enter a valid Roblox user ID.');
  return s;
}
export function roleState(membership, policy, groupId) {
  if (!membership) return { priority: 0, access: false, roles: [], label: 'Not a member' };
  const paths = membership.roles ?? (membership.role ? [membership.role] : []);
  ensure(Array.isArray(paths) && paths.length > 0, 403, 'Membership roles could not be confirmed.');
  const roles = paths.map(path => {
    const prefix = `groups/${groupId}/roles/`;
    ensure(typeof path === 'string' && path.startsWith(prefix), 403, 'Unrecognized group role.');
    const id = path.slice(prefix.length), rule = policy[id];
    ensure(rule, 403, 'A role is missing from the server access policy. Ask the owner to review it.');
    return { id, ...rule };
  });
  roles.sort((a, b) => b.priority - a.priority);
  return { priority: roles[0].priority, access: roles.some(r => r.access), roles, label: roles[0].name };
}
export function validateAction(body, actor, target, policy, botId) {
  const actions = ['assign-role', 'remove-role', 'kick', 'group-ban', 'group-unban', 'experience-ban', 'experience-unban'];
  ensure(actions.includes(body.action), 400, 'Choose a valid action.');
  const targetId = userId(body.targetId);
  ensure(actor.access, 403, 'Lead Operator or higher is required.');
  ensure(targetId !== String(actor.id) && targetId !== String(botId), 403, 'You cannot act on yourself or the service account.');
  ensure(target.priority < actor.priority, 403, 'You can only act on people below your access level.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  ensure(reason.length >= 10 && reason.length <= 400 && /[\p{L}\p{N}]/u.test(reason), 400, 'Give a clear reason between 10 and 400 characters.');
  const result = { action: body.action, targetId, reason };
  if (['assign-role', 'remove-role', 'kick'].includes(body.action)) ensure(target.roles.length, 400, 'This user is not in the group.');
  if (['assign-role', 'remove-role'].includes(body.action)) {
    const roleId = String(body.roleId ?? ''), rule = policy[roleId];
    ensure(rule?.assignable && !rule.access && rule.priority < actor.priority, 403, 'That role is protected or unavailable.');
    if (body.action === 'remove-role') ensure(target.roles.some(r => r.id === roleId), 400, 'The user does not hold that role.');
    if (body.action === 'assign-role') ensure(!target.roles.some(r => r.id === roleId), 400, 'The user already holds that role.');
    result.roleId = roleId;
  }
  if (body.action === 'experience-ban') {
    const seconds = body.duration;
    ensure(seconds === 'permanent' || (Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 31536000), 400, 'Choose a ban duration from 1 minute to 365 days, or permanent.');
    const privateReason = typeof body.privateReason === 'string' ? body.privateReason.trim() : '';
    ensure(privateReason.length >= 10 && privateReason.length <= 800, 400, 'Add an internal reason between 10 and 800 characters.');
    ensure(typeof body.includeAlts === 'boolean', 400, 'Choose whether to include suspected alternate accounts.');
    Object.assign(result, { duration: seconds, privateReason, includeAlts: body.includeAlts });
  }
  return result;
}
export function banPayload(action, actorId) {
  const gameJoinRestriction = {
    active: action.action === 'experience-ban', excludeAltAccounts: !action.includeAlts,
    displayReason: action.reason,
    privateReason: `${action.privateReason || action.reason}\nOperator: ${actorId}`
  };
  // Open Cloud indefinite restrictions omit duration. Do not send BanAsync's -1.
  if (action.action === 'experience-ban' && action.duration !== 'permanent') gameJoinRestriction.duration = `${action.duration}s`;
  return { gameJoinRestriction };
}
