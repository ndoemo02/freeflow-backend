const sessions = {};

export async function getMemory(id) {
  return sessions[id] || {};
}

export async function setMemory(id, data) {
  sessions[id] = { ...sessions[id], ...data };
}
