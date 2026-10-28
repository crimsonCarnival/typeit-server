/**
 * Code snippets for code mode, by language. Short, idiomatic and original
 * (written for TypeIt). Lines are typed one after another with Enter;
 * leading indentation is dropped when the text is built, so nobody has to
 * type spaces to line code up.
 */
export const CODE_SNIPPETS = Object.freeze({
  javascript: [
    `const sum = (values) => values.reduce((total, n) => total + n, 0);
console.log(sum([1, 2, 3, 4]));`,
    `function debounce(fn, wait) {
let timer = null;
return (...args) => {
clearTimeout(timer);
timer = setTimeout(() => fn(...args), wait);
};
}`,
    `const users = await fetch('/api/users').then((res) => res.json());
const names = users.filter((u) => u.active).map((u) => u.name);`,
    `export class Counter {
#count = 0;
increment() {
return ++this.#count;
}
}`,
    `const groups = items.reduce((acc, item) => {
(acc[item.type] ??= []).push(item);
return acc;
}, {});`,
    `for (const [key, value] of Object.entries(config)) {
if (value === undefined) delete config[key];
}`,
    `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(250);`,
    `document.querySelector('#save').addEventListener('click', async () => {
await save(form.value);
toast('Saved!');
});`,
  ],
  python: [
    `def fizzbuzz(n):
for i in range(1, n + 1):
print("Fizz" * (i % 3 == 0) + "Buzz" * (i % 5 == 0) or i)`,
    `squares = {n: n * n for n in range(10) if n % 2 == 0}
print(squares)`,
    `with open("data.csv") as f:
rows = [line.strip().split(",") for line in f]`,
    `class Stack:
def __init__(self):
self.items = []
def push(self, item):
self.items.append(item)
def pop(self):
return self.items.pop()`,
    `from collections import Counter
words = text.lower().split()
print(Counter(words).most_common(5))`,
    `def retry(times):
def wrap(fn):
def inner(*args, **kwargs):
for attempt in range(times):
try:
return fn(*args, **kwargs)
except Exception:
if attempt == times - 1:
raise
return inner
return wrap`,
    `numbers = sorted(set(map(int, input().split())), reverse=True)
print(numbers[:3])`,
  ],
  go: [
    `func Sum(nums []int) int {
total := 0
for _, n := range nums {
total += n
}
return total
}`,
    `if err := db.Ping(); err != nil {
log.Fatalf("database unreachable: %v", err)
}`,
    `type Point struct {
X, Y float64
}
func (p Point) Dist() float64 {
return math.Hypot(p.X, p.Y)
}`,
    `ch := make(chan int, 3)
go func() {
defer close(ch)
for i := 0; i < 3; i++ {
ch <- i
}
}()`,
    `counts := map[string]int{}
for _, w := range strings.Fields(text) {
counts[w]++
}`,
  ],
  rust: [
    `fn main() {
let words = vec!["alpha", "beta", "gamma"];
for (i, w) in words.iter().enumerate() {
println!("{}: {}", i, w);
}
}`,
    `let total: i32 = nums.iter().filter(|n| **n > 0).sum();`,
    `#[derive(Debug, Clone)]
struct User {
name: String,
age: u8,
}`,
    `match parse(input) {
Ok(value) => println!("got {value}"),
Err(e) => eprintln!("error: {e}"),
}`,
    `fn largest<T: PartialOrd + Copy>(list: &[T]) -> T {
let mut max = list[0];
for &item in list {
if item > max { max = item; }
}
max
}`,
  ],
  sql: [
    `SELECT name, COUNT(*) AS orders
FROM customers c
JOIN orders o ON o.customer_id = c.id
GROUP BY name
ORDER BY orders DESC;`,
    `UPDATE accounts SET balance = balance - 50 WHERE id = 7;`,
    `CREATE TABLE posts (
id SERIAL PRIMARY KEY,
title TEXT NOT NULL,
created_at TIMESTAMP DEFAULT now()
);`,
    `SELECT * FROM events
WHERE created_at >= '2026-01-01'
AND kind IN ('signup', 'login')
LIMIT 20;`,
    `DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP;`,
  ],
  bash: [
    `for f in *.log; do
gzip "$f"
done`,
    `grep -rn "TODO" src | wc -l`,
    `if [ -z "$API_KEY" ]; then
echo "API_KEY is not set" >&2
exit 1
fi`,
    `find . -name "*.tmp" -mtime +7 -delete`,
    `tar -czf backup-$(date +%F).tar.gz ./data && echo "done"`,
  ],
});

export const CODE_LANGUAGES = Object.freeze(Object.keys(CODE_SNIPPETS));
