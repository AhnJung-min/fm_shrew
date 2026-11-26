import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FaceFinder, faceUidFrom, imageRequestFrom, LogoFinder } from '../src/main/graphics'

function graphicsDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'faces-'))
  const faces = join(root, 'Megapack', 'Faces')
  mkdirSync(faces, { recursive: true })
  writeFileSync(join(faces, 'face_1001.png'), 'x')
  const other = join(root, 'Other', 'inner', 'faces')
  mkdirSync(other, { recursive: true })
  writeFileSync(join(other, '2002.png'), 'x')
  // 너무 깊은 곳은 찾지 않는다
  const deep = join(root, 'a', 'b', 'c', 'd', 'faces')
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(deep, 'face_3003.png'), 'x')
  return root
}

describe('FaceFinder', () => {
  it('faces 폴더를 대소문자와 상관없이 찾고, 두 가지 파일 이름을 모두 읽는다', () => {
    const finder = new FaceFinder(graphicsDir())
    expect(finder.folders()).toHaveLength(2)
    expect(finder.find(1001)).toMatch(/face_1001\.png$/)
    expect(finder.find(2002)).toMatch(/2002\.png$/)
  })
  it('없는 선수와 너무 깊은 폴더의 사진은 null이다', () => {
    const finder = new FaceFinder(graphicsDir())
    expect(finder.find(9999)).toBeNull()
    expect(finder.find(3003)).toBeNull()
    expect(finder.find(-1)).toBeNull()
  })
  it('그래픽 폴더가 없어도 오류 없이 null을 준다', () => {
    expect(new FaceFinder(join(tmpdir(), 'no-such-graphics-dir')).find(1)).toBeNull()
  })
})

describe('faceUidFrom', () => {
  it('숫자 번호만 받는다', () => {
    expect(faceUidFrom('fmface://face/12345')).toBe(12345)
    expect(faceUidFrom('fmface://face/..%2Fsecret')).toBeNull()
    expect(faceUidFrom('fmface://face/12a')).toBeNull()
    expect(faceUidFrom('fmface://face/')).toBeNull()
  })
})

describe('LogoFinder', () => {
  it('Clubs 폴더의 Normal 안을 먼저 보고, 두 가지 파일 이름을 모두 읽는다', () => {
    const root = mkdtempSync(join(tmpdir(), 'logos-'))
    const normal = join(root, 'Logo Pack', 'Clubs', 'Normal')
    mkdirSync(normal, { recursive: true })
    writeFileSync(join(normal, '501_club.png'), 'x')
    const plain = join(root, 'Other', 'clubs')
    mkdirSync(plain, { recursive: true })
    writeFileSync(join(plain, '602.png'), 'x')
    const finder = new LogoFinder(root)
    expect(finder.find(501)).toMatch(/Normal[\\/]501_club\.png$/)
    expect(finder.find(602)).toMatch(/602\.png$/)
    expect(finder.find(703)).toBeNull()
  })
})

describe('imageRequestFrom', () => {
  it('얼굴과 엠블럼을 가리고 숫자 번호만 받는다', () => {
    expect(imageRequestFrom('fmface://face/12')).toEqual({ kind: 'face', uid: 12 })
    expect(imageRequestFrom('fmface://club/34')).toEqual({ kind: 'club', uid: 34 })
    expect(imageRequestFrom('fmface://kit/34')).toBeNull()
    expect(imageRequestFrom('fmface://club/..%2F34')).toBeNull()
    expect(faceUidFrom('fmface://club/34')).toBeNull()
  })
})
