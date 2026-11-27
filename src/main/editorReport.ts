import { EDITOR_FIELD_LABEL, type EditorApplyReport, type EditorField, type EditorPlayerResult } from '@shared/connect'
import type { EditorEdit } from '@shared/world'
import type { LivePlayer, LiveSetOutcome } from './talk/bridge'

/** 에디터가 한 선수에 보내는 항목들(보낸 것만) */
export function fieldsOf(edit: EditorEdit): EditorField[] {
  const fields: EditorField[] = []
  if (edit.ca !== undefined) fields.push('ca')
  if (edit.pa !== undefined) fields.push('pa')
  if (edit.positions) fields.push('positions')
  if (edit.attributes) fields.push('attributes')
  return fields
}

const sameList = (sent: number[], got: number[] | undefined): boolean => got !== undefined && sent.length === got.length && sent.every((value, i) => value === got[i])

/** 게임이 넣은 뒤 돌려준 값과 보낸 값을 항목마다 견줘, 들어간 것과 들어가지 않은 것으로 나눈다 */
export function landedFields(edit: EditorEdit, after: LivePlayer): { written: EditorField[]; failed: EditorField[] } {
  const written: EditorField[] = []
  const failed: EditorField[] = []
  for (const field of fieldsOf(edit)) {
    const landed =
      field === 'ca' ? edit.ca === after.ca : field === 'pa' ? edit.pa === after.pa : sameList(field === 'positions' ? edit.positions! : edit.attributes!, field === 'positions' ? after.positions : after.attributes)
    ;(landed ? written : failed).push(field)
  }
  return { written, failed }
}

const FIELD_IDS: EditorField[] = ['ca', 'pa', 'positions', 'attributes']
/** 플러그인이 알려 준 부분 이름을 항목으로. 모르는 이름은 버린다 */
const asFields = (parts: string[]): EditorField[] => parts.filter((part): part is EditorField => (FIELD_IDS as string[]).includes(part))

/**
 * 한 선수의 결과. 게임이 답하지 않았거나(offline), 온라인 게임이라 막았거나(online), 쓰다가 실패했으면(failed) 보낸 항목은 들어간 것으로 보지 않는다.
 * 실패했을 때 플러그인이 되돌렸으면(restored) 게임의 값은 쓰기 전과 같다. 되돌리지 못했으면(restored가 false) 일부만 들어가 있을 수 있다.
 * ok이면 게임이 돌려준 값을 보낸 값과 항목마다 견준다. found가 1이 아니면 게임에서 그 선수를 찾지 못한 것이다.
 */
export function playerResult(edit: EditorEdit, name: string, outcome: LiveSetOutcome): EditorPlayerResult {
  const all = fieldsOf(edit)
  const failedAll = (extra: Partial<EditorPlayerResult>): EditorPlayerResult => ({ uid: edit.uid, name, status: 'failed', written: [], failed: all, ...extra })
  if (outcome.kind === 'offline') return failedAll({ note: '게임에 연결하지 못했습니다.' })
  if (outcome.kind === 'online') return failedAll({ online: true, note: '온라인(네트워크) 게임에서는 값을 넣을 수 없어 막았습니다.' })
  if (outcome.kind === 'failed') {
    const rolledBack = asFields(outcome.rolledBack)
    const where = outcome.failedAt ? `${EDITOR_FIELD_LABEL[outcome.failedAt as EditorField] ?? outcome.failedAt}를 넣다가 실패했습니다. ` : ''
    // 되돌리지 못했으면 되돌리려던 항목은 새 값이 남아 있을 수 있다. 어느 쪽인지 모르는 항목은 들어간 것으로 세지 않는다
    const note =
      outcome.restored === false
        ? `${where}되돌리지도 못해 게임에 값이 섞여 있을 수 있습니다. 게임에서 이 선수를 확인해 주세요.`
        : outcome.restored === true || rolledBack.length > 0
          ? `${where}앞에서 넣은 값은 원래대로 되돌렸습니다.`
          : `${where}${outcome.error}`
    return failedAll({ rolledBack, restored: outcome.restored, note })
  }
  const after = outcome.player
  if (after.found !== 1) return failedAll({ note: '켜져 있는 게임에서 이 선수의 기록을 찾지 못했습니다.' })
  const { written, failed } = landedFields(edit, after)
  const status = failed.length === 0 ? 'written' : written.length === 0 ? 'failed' : 'partial'
  return { uid: edit.uid, name, status, written, failed, note: failed.length > 0 ? '값을 넣었지만 다시 읽은 값이 다릅니다.' : undefined }
}

/** 앞 선수에서 멈춰 보내지 않은 선수의 결과(값은 그대로다) */
export function skippedResult(edit: EditorEdit, name: string): EditorPlayerResult {
  return { uid: edit.uid, name, status: 'skipped', written: [], failed: [], note: '앞 선수에서 멈춰 보내지 않았습니다.' }
}

const labels = (fields: EditorField[]): string => fields.map((field) => EDITOR_FIELD_LABEL[field]).join(', ')

/** 선수별 결과를 한눈에 읽을 한 덩어리 글로. 모두 들어갔으면 ok */
export function reportOf(players: EditorPlayerResult[]): EditorApplyReport {
  const ok = players.length > 0 && players.every((player) => player.status === 'written')
  if (ok) {
    return {
      ok,
      players,
      message: `${players.map((player) => player.name).join(', ')}의 값을 게임에 반영했습니다. 게임에서 그 선수 화면을 다시 열면 보입니다. 게임에서 저장해야 세이브에도 남습니다.`
    }
  }
  const lines = players.map((player) => {
    if (player.status === 'written') return `${player.name}: 모두 반영함.`
    if (player.status === 'skipped') return `${player.name}: 보내지 않음(게임의 값 그대로).`
    return `${player.name}: 반영 ${player.written.length > 0 ? labels(player.written) : '없음'}, 미반영 ${labels(player.failed)}.${player.note ? ` ${player.note}` : ''}`
  })
  const any = players.some((player) => player.written.length > 0)
  return { ok, players, message: `${any ? '일부만 반영했습니다.' : '반영하지 못했습니다.'} ${lines.join(' ')}` }
}
