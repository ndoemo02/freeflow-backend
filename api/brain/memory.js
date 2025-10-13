// api/brain/memory.js
let memory = {
  context: null,
  lastIntent: null,
  lastMessage: null,
  status: 'idle',
};

export async function getMemory() {
  return memory;
}

export async function setMemory(update) {
  memory = { ...memory, ...update };
}