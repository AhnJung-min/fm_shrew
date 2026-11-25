import { desktopCapturer, screen, type NativeImage } from 'electron'

export interface Captured {
  image: NativeImage
  source: 'window' | 'screen'
}

const GAME_WINDOW = /football manager/i
/** AI에 보내는 이미지의 긴 변 최대 길이. 글자가 읽히는 선에서 전송량을 줄인다. */
const MAX_EDGE = 1920

/**
 * 게임 창을 찍는다. 다른 창이나 바탕화면은 찍지 않는다.
 * 게임이 독점 전체 화면이라 창으로 잡히지 않으면, 허용한 경우에만 주 모니터 전체를 찍는다.
 */
export async function captureGame(allowWholeScreen: boolean): Promise<Captured> {
  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor
  const thumbnailSize = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale)
  }

  const windows = await desktopCapturer.getSources({ types: ['window'], thumbnailSize })
  const game = windows.find((source) => GAME_WINDOW.test(source.name) && !source.thumbnail.isEmpty())
  if (game) return { image: fit(game.thumbnail), source: 'window' }

  if (!allowWholeScreen) {
    throw new Error(
      '게임 창을 찾지 못했습니다. Football Manager 26이 켜져 있는지 확인하고, 게임의 화면 모드를 창 모드로 바꿔 보세요. 그래도 안 되면 설정에서 “화면 전체 캡처 허용”을 켤 수 있습니다.'
    )
  }
  const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const primary = screens.find((source) => source.display_id === String(display.id)) ?? screens[0]
  if (!primary || primary.thumbnail.isEmpty()) throw new Error('화면을 캡처하지 못했습니다.')
  return { image: fit(primary.thumbnail), source: 'screen' }
}

function fit(image: NativeImage): NativeImage {
  const { width, height } = image.getSize()
  const longest = Math.max(width, height)
  if (longest <= MAX_EDGE) return image
  const ratio = MAX_EDGE / longest
  return image.resize({ width: Math.round(width * ratio), height: Math.round(height * ratio), quality: 'best' })
}

/** 화면에 보여 줄 작은 미리보기 */
export function previewOf(image: NativeImage): string {
  const { width } = image.getSize()
  const small = width > 640 ? image.resize({ width: 640, quality: 'good' }) : image
  return `data:image/jpeg;base64,${small.toJPEG(70).toString('base64')}`
}
