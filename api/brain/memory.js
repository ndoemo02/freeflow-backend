// api/brain/memory.js
let memory = {
  status: 'idle',
  context: null,
  lastIntent: null,
  lastMessage: null,
  userMessage: null,
  timestamp: new Date().toISOString(),
};

export async function getMemory() {
  return memory;
}

export async function setMemory(update) {
  memory = { ...memory, ...update, timestamp: new Date().toISOString() };
  console.log('🧠 Memory updated:', memory);
  return memory;
}

export async function resetMemory() {
  memory = {
    status: 'idle',
    context: null,
    lastIntent: null,
    lastMessage: null,
    userMessage: null,
    timestamp: new Date().toISOString(),
  };
  return memory;
}