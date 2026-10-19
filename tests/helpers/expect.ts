import assert from 'node:assert/strict'

/**
 * 极简断言封装：让测试保持 expect(...) 的可读写法，
 * 底层用 node:assert 实现，不依赖任何第三方测试框架。
 */
interface Matchers {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeNull(): void
  toBeUndefined(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeGreaterThan(expected: number): void
  toBeLessThan(expected: number): void
  toContain(expected: unknown): void
  toHaveLength(expected: number): void
  toMatch(pattern: RegExp | string): void
  toThrow(message?: string | RegExp): void
  not: {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
    toBeTruthy(): void
    toBeNull(): void
    toBeUndefined(): void
    toHaveLength(expected: number): void
  }
}

export function expect(actual: unknown): Matchers {
  const positive = {
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected)
    },
    toEqual(expected: unknown) {
      assert.deepStrictEqual(actual, expected)
    },
    toBeNull() {
      assert.strictEqual(actual, null)
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined)
    },
    toBeTruthy() {
      assert.ok(actual)
    },
    toBeFalsy() {
      assert.ok(!actual)
    },
    toBeGreaterThan(expected: number) {
      assert.ok((actual as number) > expected, `期望 ${String(actual)} 大于 ${expected}`)
    },
    toBeLessThan(expected: number) {
      assert.ok((actual as number) < expected, `期望 ${String(actual)} 小于 ${expected}`)
    },
    toContain(expected: unknown) {
      if (typeof actual === 'string') {
        assert.ok(
          actual.includes(String(expected)),
          `期望字符串包含「${String(expected)}」，实际为「${actual}」`,
        )
        return
      }
      assert.ok(
        Array.isArray(actual) && actual.includes(expected),
        `期望数组包含「${String(expected)}」`,
      )
    },
    toHaveLength(expected: number) {
      assert.strictEqual((actual as ArrayLike<unknown>).length, expected)
    },
    toMatch(pattern: RegExp | string) {
      if (typeof pattern === 'string') {
        assert.ok(String(actual).includes(pattern), `期望包含「${pattern}」`)
        return
      }
      assert.match(String(actual), pattern)
    },
    toThrow(message?: string | RegExp) {
      const block = actual as () => void
      let didThrow = false
      let thrown: unknown
      try {
        block()
      } catch (error) {
        didThrow = true
        thrown = error
      }
      assert.ok(didThrow, '期望抛出错误，但没有抛出任何错误')
      if (message === undefined) return
      const text = thrown instanceof Error ? thrown.message : String(thrown)
      if (typeof message === 'string') {
        assert.ok(text.includes(message), `期望错误信息包含「${message}」，实际为「${text}」`)
      } else {
        assert.match(text, message)
      }
    },
  }

  const not = {
    toBe(expected: unknown) {
      assert.notStrictEqual(actual, expected)
    },
    toEqual(expected: unknown) {
      assert.notDeepStrictEqual(actual, expected)
    },
    toContain(expected: unknown) {
      if (typeof actual === 'string') {
        assert.ok(!actual.includes(String(expected)), `不应包含「${String(expected)}」，实际为「${actual}」`)
        return
      }
      assert.ok(
        !(Array.isArray(actual) && actual.includes(expected)),
        `数组不应包含「${String(expected)}」`,
      )
    },
    toBeTruthy() {
      assert.ok(!actual, `期望为假值，实际为 ${String(actual)}`)
    },
    toBeNull() {
      assert.notStrictEqual(actual, null)
    },
    toBeUndefined() {
      assert.notStrictEqual(actual, undefined)
    },
    toHaveLength(expected: number) {
      assert.notStrictEqual((actual as ArrayLike<unknown>).length, expected)
    },
  }

  return { ...positive, not }
}

export { describe, it, before, after, beforeEach, afterEach } from 'node:test'
