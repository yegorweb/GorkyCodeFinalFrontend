import type { components } from './backend'

declare global {
  type User = components['schemas']['User']
  type LoginRequest = components['schemas']['LoginRequest']
  type BackendApiError = components['schemas']['ApiError']
  type UseAuthOptions<T extends boolean = false> = { required?: T }
}

export { User, LoginRequest, BackendApiError, UseAuthOptions }
