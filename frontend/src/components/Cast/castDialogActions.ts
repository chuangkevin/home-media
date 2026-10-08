import type { RootState } from '../../store'
import type { socketService } from '../../services/socket.service'
import { setCastTargets, setIsController } from '../../store/castingSlice'

interface CastStore {
  getState: () => Pick<RootState, 'casting' | 'player'>
  dispatch: (
    action: ReturnType<typeof setCastTargets> | ReturnType<typeof setIsController>
  ) => unknown
}

type CastTransport = Pick<typeof socketService, 'startCast' | 'stopCast'>

export function toggleDraftCastTarget(targets: string[], deviceId: string, isController: boolean) {
  if (isController) return targets
  return targets.includes(deviceId)
    ? targets.filter((id) => id !== deviceId)
    : [...targets, deviceId]
}

export function startDraftCast(store: CastStore, transport: CastTransport, draftTargets: string[]) {
  const { casting, player } = store.getState()
  if (
    !casting.isConnected ||
    casting.isController ||
    !player.currentTrack ||
    !draftTargets.length
  ) {
    return false
  }
  const targets = [...draftTargets]
  transport.startCast(targets, player.currentTrack, player.currentTime, player.isPlaying)
  store.dispatch(setCastTargets(targets))
  store.dispatch(setIsController(true))
  return true
}

export function stopActiveCast(store: CastStore, transport: CastTransport) {
  const { isController, castTargets } = store.getState().casting
  if (!isController) return false
  // Read active targets at the moment of stopping, never the dialog's draft.
  transport.stopCast([...castTargets])
  store.dispatch(setIsController(false))
  return true
}
