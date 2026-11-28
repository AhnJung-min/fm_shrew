/*
  단위 B(바탕과 증거)의 시나리오 표본. scripts/ui-shots.mjs의 run이 읽는다.
    node scripts/ui-shots.mjs run scripts/scenarios/B.mjs --url http://localhost:<포트> --out <폴더>
  걸음: goto, viewport, media, click, hover, key, type, wheel, wait, eval, measure, assert, shot.
  단언은 화면 안에서 참을 돌려주는 식이다. 틀리면 이 명령은 0이 아닌 값으로 끝난다.
  다른 단위는 자기 시나리오(scripts/scenarios/<단위>.mjs)를 따로 둔다.
*/

/** 지금 초점이 있는 요소에 초점 링이 보이는가(:focus-visible이고 윤곽선이 2px 이상) */
const FOCUS_RING_VISIBLE = `(() => {
  const el = document.activeElement
  if (!el || el === document.body) return false
  if (!el.matches(':focus-visible')) return false
  const style = getComputedStyle(el)
  return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
})()`

export default {
  unit: 'B',
  scenarios: [
    {
      name: 'dashboard-tab-focus',
      viewport: '1304x800',
      steps: [
        { goto: '/#dashboard' },
        { assert: "document.querySelector('.sidebar') !== null", message: '대시보드 사이드바가 그려졌다' },
        { key: 'Tab' },
        { key: 'Tab' },
        { key: 'Tab' },
        { assert: FOCUS_RING_VISIBLE, message: '대시보드에서 Tab 세 번 뒤 초점 링이 보인다' },
        { measure: 'after-tab' },
        { shot: 'focus' }
      ]
    },
    {
      name: 'squad-sticky-name',
      viewport: '1304x800',
      steps: [
        { goto: '/#squad' },
        { assert: "document.querySelectorAll('.ptable tbody tr.row').length > 5", message: '스쿼드 표에 선수 줄이 그려졌다' },
        { measure: 'squad-before-scroll' },
        { wheel: { selector: '.table-scroll', deltaX: 600 } },
        { assert: "document.querySelector('.table-scroll').scrollLeft > 0", message: '표가 오른쪽으로 밀렸다' },
        {
          assert: `(() => {
            const scroller = document.querySelector('.table-scroll')
            const cell = scroller.querySelector('tbody td.sticky-col')
            return Math.abs(cell.getBoundingClientRect().left - scroller.getBoundingClientRect().left) < 1
          })()`,
          message: '오른쪽으로 민 뒤에도 이름 칸이 제자리에 붙어 있다'
        },
        { shot: 'scrolled-right' }
      ]
    },
    {
      name: 'targets-row-opens-panel',
      viewport: '1304x800',
      steps: [
        { goto: '/#targets' },
        { assert: "document.querySelectorAll('.ptable tbody tr.row').length > 0", message: '영입 후보 표에 줄이 그려졌다' },
        { click: '.table-scroll tbody tr.row td.sticky-col' },
        { assert: "document.querySelector('.drawer') !== null", message: '줄을 누르면 선수 정보 창이 열린다' },
        { key: 'Escape' },
        { measure: 'targets' }
      ]
    }
  ]
}
