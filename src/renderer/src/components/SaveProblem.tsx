import { CircleAlert } from 'lucide-react'
import type { SaveCheck } from '@shared/connect'

/**
 * 세이브 형식 점검(A-16)에 걸렸을 때 점수 화면(대시보드·스쿼드·영입 후보·선수 비교) 대신 보여 주는 안내.
 * 틀린 점수를 보여 주지 않으려고 화면을 막는다. 백업과 설정은 그대로 쓸 수 있다.
 */
export function SaveProblem(props: { title: string; check: SaveCheck; onGoHome: () => void }) {
  const { title, check, onGoHome } = props
  return (
    <>
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <div className="page-body">
        <div className="empty guide" role="alert">
          <strong>
            <CircleAlert size={16} /> 세이브 형식이 바뀐 것 같습니다
          </strong>
          <p>게임이 업데이트되어 세이브의 구조가 달라졌을 수 있습니다. 틀린 점수를 보여 주지 않으려고 점수가 나오는 화면을 막았습니다. 백업과 설정은 그대로 쓸 수 있습니다.</p>
          <p>읽은 값에서 이상했던 것:</p>
          <ul className="problem-list">
            {check.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <button className="btn" onClick={onGoHome}>
            시작 화면으로
          </button>
        </div>
      </div>
    </>
  )
}
