import { createContext, useContext } from 'react'

const RegistryContext = createContext({ collections: [], selections: [], byType: {}, withSelections: [] })

export const RegistryProvider = RegistryContext.Provider

export function useRegistry() {
  return useContext(RegistryContext)
}
