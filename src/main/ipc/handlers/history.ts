/**
 * IPC handlers for browsing history management.
 */

import type { ServiceRegistry } from '../../services'
import {
  historyChangeModeContract,
  historyClearContract,
  historyDeleteByDateContract,
  historyDeleteContract,
  historyDeletePatternContract,
  historyGetByDateContract,
  historyGetRecentContract,
  historyGetStatsContract,
  historyGetTopContract,
  historyHasPersistentFileContract,
  historySearchContract,
} from '../../../shared/ipc-contract/history'
import { ipcFailure, secureContractHandle } from '../contract-handler'

/**
 * Queries return data and mutations return explicit outcomes. Exceptions never
 * masquerade as empty data; they cross the boundary as stable IPC failures.
 */
export function registerHistoryHandlers(registry: ServiceRegistry): void {
  const { historyManager } = registry

  secureContractHandle(historyChangeModeContract, async (mode) => {
    try {
      await registry.settingsCoordinator.apply({ privacy: { historyMode: mode } }, { reconcileHistory: true })
      return { success: true }
    } catch (error) {
      ipcFailure('HISTORY_MODE_CHANGE_FAILED', 'Unable to change history mode', false, error)
    }
  })

  secureContractHandle(historySearchContract, (query, limit?: number) => {
    try {
      return historyManager.search(query, limit)
    } catch (error) {
      ipcFailure('HISTORY_SEARCH_FAILED', 'Unable to search history', false, error)
    }
  })

  secureContractHandle(historyGetRecentContract, (limit?: number) => {
    try {
      return historyManager.getRecent(limit)
    } catch (error) {
      ipcFailure('HISTORY_READ_FAILED', 'Unable to read recent history', false, error)
    }
  })

  secureContractHandle(historyGetTopContract, (limit?: number) => {
    try {
      return historyManager.getTopVisited(limit)
    } catch (error) {
      ipcFailure('HISTORY_READ_FAILED', 'Unable to read top history', false, error)
    }
  })

  secureContractHandle(historyGetByDateContract, (startDate, endDate) => {
    try {
      return historyManager.getByDateRange(startDate, endDate)
    } catch (error) {
      ipcFailure('HISTORY_READ_FAILED', 'Unable to read history range', false, error)
    }
  })

  secureContractHandle(historyDeleteContract, (id) => {
    try {
      const success = historyManager.deleteEntry(id)
      return { success }
    } catch (error) {
      ipcFailure('HISTORY_DELETE_FAILED', 'Unable to delete history entry', false, error)
    }
  })

  secureContractHandle(historyDeleteByDateContract, (startDate, endDate) => {
    try {
      const count = historyManager.deleteByDateRange(startDate, endDate)
      return { success: true, count }
    } catch (error) {
      ipcFailure('HISTORY_DELETE_FAILED', 'Unable to delete history range', false, error)
    }
  })

  secureContractHandle(historyDeletePatternContract, (pattern) => {
    try {
      const count = historyManager.deleteByPattern(pattern)
      return { success: true, count }
    } catch (error) {
      ipcFailure('HISTORY_DELETE_FAILED', 'Unable to delete matching history', false, error)
    }
  })

  secureContractHandle(historyClearContract, () => {
    try {
      historyManager.clear()
      return { success: true }
    } catch (error) {
      ipcFailure('HISTORY_CLEAR_FAILED', 'Unable to clear history', false, error)
    }
  })

  secureContractHandle(historyGetStatsContract, () => {
    try {
      return historyManager.getStats()
    } catch (error) {
      ipcFailure('HISTORY_STATS_FAILED', 'Unable to read history statistics', false, error)
    }
  })

  secureContractHandle(historyHasPersistentFileContract, () => {
    try {
      return historyManager.hasPersistentFile()
    } catch (error) {
      ipcFailure('HISTORY_STORAGE_CHECK_FAILED', 'Unable to inspect history storage', false, error)
    }
  })
}
