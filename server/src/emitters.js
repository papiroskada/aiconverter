// Shared SSE emitter registries — imported by both route files and services
// to avoid circular dependencies between routes.
export const programSseEmitters = new Map()  // programId → Set<res>
export const appSseEmitters = new Map()       // applicationId → Set<res>
