import type { components } from './backend'

declare global {
  type ConstructorTask = components['schemas']['ConstructorTask']
  type ConstructorDraft = components['schemas']['ConstructorDraft']
  type ConstructorDraftInput = components['schemas']['ConstructorDraftInput']
  type ConstructorVersion = components['schemas']['ConstructorVersion']
  type ConstructorPublishInput = components['schemas']['ConstructorPublishInput']
}

export { ConstructorTask, ConstructorDraft, ConstructorDraftInput, ConstructorVersion, ConstructorPublishInput }
