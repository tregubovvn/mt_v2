const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('/workspace/index.html', 'utf8');
let appJs = fs.readFileSync('/workspace/app.js', 'utf8');
appJs += '\n;window.__T = {\n  get questions(){return questions}, set questions(v){questions=v},\n  get userAnswers(){return userAnswers},\n  get crushErrors(){return crushErrors}, get crushState(){return crushState},\n  get currentQuestionIndex(){return currentQuestionIndex},\n  selectAnswer, handleCrushCheck, handleCheckClick, goToQuestion, parseMoodleXML, renderQuestion\n};';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  \u2713', msg); } else { fail++; console.log('  \u2717 FAIL:', msg); } }

async function run(flags, fn) {
    const dom = new JSDOM(html, { url: 'http://localhost/?name=x.xml&' + flags, runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window;
    w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
    w.fetch = () => Promise.reject(new Error('no network in test'));
    const s = w.document.createElement('script');
    s.textContent = appJs;
    w.document.body.appendChild(s);
    await new Promise(r => setTimeout(r, 50));
    const T = w.__T;
    if (!T) throw new Error('app script failed to load');
    const setup = w.document.createElement('script');
    setup.textContent = `testTopicName=''; __T.questions = parseMoodleXML(DEMO_QUIZ_XML); startTest();`;
    w.document.body.appendChild(setup);
    fn(w, w.document, T);
}

(async () => {
console.log('\n[CrushMode]');
await run('crushmode=true', (w, d, T) => {
    const vis = id => !d.getElementById(id).classList.contains('hidden');
    ok(!vis('prevBtn'), '«Назад» скрыта (возврат запрещён)');
    ok(vis('checkAnswerBtn'), '«Проверить ответ» видна (одна кнопка)');
    ok(!d.getElementById('crushCheckBtn'), 'дубль «Проверить» удалён из DOM');
    ok(!vis('nextBtn') && !vis('finishBtn'), '«Вперёд»/«Завершить» скрыты');
    ok(!vis('crushNextBtn'), '«Дальше →» скрыта до верного ответа');
    ok(T.currentQuestionIndex === 0, 'старт с первого вопроса');

    const q0 = T.questions[0];
    const wrongIdx = q0.answers.findIndex(a => !a.isCorrect);
    const wrongIdx2 = q0.answers.findIndex((a, i) => !a.isCorrect && i !== wrongIdx);

    T.selectAnswer(wrongIdx); d.getElementById('checkAnswerBtn').click();
    ok(T.crushErrors === 1, 'ошибка засчитана (1)');
    ok(d.querySelectorAll('.answer-option.incorrect').length === 1, 'неверный выбран красным');
    ok(d.querySelectorAll('.answer-option.correct').length === 0, 'правильный НЕ раскрыт');
    ok(!vis('crushNextBtn'), '«Дальше →» всё ещё скрыта');

    T.selectAnswer(wrongIdx2); d.getElementById('checkAnswerBtn').click();
    ok(T.crushErrors === 2, 'вторая ошибка засчитана');
    ok(d.querySelectorAll('.answer-option.incorrect').length === 1, 'старая подсветка снята, новый неверный — красный');

    T.selectAnswer(wrongIdx); d.getElementById('checkAnswerBtn').click();
    ok(T.currentQuestionIndex === 0 && T.crushErrors === 0, '3 ошибки -> возврат к первому вопросу, счётчик сброшен');
    ok(T.userAnswers.every(a => a === null), 'ответы очищены после рестарта');

    const qNow = T.questions[T.currentQuestionIndex];
    const ci = qNow.answers.findIndex(a => a.isCorrect);
    T.selectAnswer(ci); d.getElementById('checkAnswerBtn').click();
    ok(T.crushState === 'correct', 'верный ответ -> состояние CORRECT');
    ok(d.querySelectorAll('.answer-option.correct').length >= 1, 'верный вариант зелёный');
    ok(vis('crushNextBtn'), '«Дальше →» открылась');
    ok(d.getElementById('checkAnswerBtn').disabled, '«Проверить ответ» отключена после верного');

    T.goToQuestion(1);
    ok(T.currentQuestionIndex === 0, 'прямой переход вперёд заблокирован (только через «Дальше →»)');
    d.getElementById('crushNextBtn').click();
    ok(T.currentQuestionIndex === 1, '«Дальше →» перешла к следующему вопросу');
    ok(!vis('crushNextBtn'), 'на новом вопросе «Дальше →» снова скрыта');
    ok(JSON.stringify(T.questions.map(q => q.name)) === JSON.stringify(['Пример с формулой 1','Пример с формулой 2','Пример с таблицей']), 'вопросы идут в порядке расположения в тесте');
});

console.log('\n[CrushMode + CheckMode]');
await run('crushmode=true&checkmode=true', (w, d, T) => {
    const vis = id => !d.getElementById(id).classList.contains('hidden');
    ok(vis('checkAnswerBtn') && !d.getElementById('crushCheckBtn'), 'одна общая кнопка проверки');
    const q0 = T.questions[0];
    const wi = q0.answers.findIndex(a => !a.isCorrect);
    T.selectAnswer(wi); d.getElementById('checkAnswerBtn').click();
    ok(T.crushErrors === 1, 'проверка работает по правилам CrushMode');
    ok(d.querySelectorAll('.answer-option.correct').length === 0, 'правильный ответ не раскрыт подсказкой');
});

console.log('\n[CheckMode]');
await run('checkmode=true', (w, d, T) => {
    const vis = id => !d.getElementById(id).classList.contains('hidden');
    ok(vis('checkAnswerBtn'), 'кнопка «Проверить ответ» есть (одна)');
    ok(vis('prevBtn') && vis('nextBtn'), 'навигация Назад/Вперёд доступна');
    ok(!vis('crushNextBtn'), '«Дальше →» не используется');

    const q0 = T.questions[0];
    const wi = q0.answers.findIndex(a => !a.isCorrect);
    T.selectAnswer(wi);
    d.getElementById('checkAnswerBtn').click();
    ok(d.querySelector('.answer-option.incorrect'), 'неверный выбор — красный');
    ok(d.querySelectorAll('.answer-option.correct').length >= 1, 'правильный вариант — зелёный');
    ok(d.getElementById('checkAnswerBtn').disabled, 'кнопка проверки отключена (ответ зафиксирован)');
    const before = T.userAnswers[T.currentQuestionIndex];
    T.selectAnswer(q0.answers.findIndex(a => a.isCorrect));
    ok(T.userAnswers[T.currentQuestionIndex] === before, 'изменить ответ после проверки нельзя');
    ok(d.querySelector('.check-feedback .status-badge.incorrect'), 'фидбек «Неверно» с правильным ответом');
    d.getElementById('nextBtn').click();
    ok(T.currentQuestionIndex === 1, 'переход «Вперёд» доступен после ошибки (сколько угодно ошибок)');
    T.goToQuestion(0);
    ok(T.currentQuestionIndex === 0, 'возврат назад разрешён в CheckMode');
    ok(d.getElementById('checkAnswerBtn').disabled, 'после возврата на проверенный вопрос кнопка проверки остаётся отключённой');
    T.goToQuestion(2);
    ok(!vis('nextBtn') && vis('finishBtn'), 'на последнем вопросе активна «Завершить тест»');
});

console.log('\n[Обычный режим]');
await run('', (w, d, T) => {
    const vis = id => !d.getElementById(id).classList.contains('hidden');
    ok(!vis('checkAnswerBtn'), 'кнопки проверки нет');
    ok(vis('prevBtn') && vis('nextBtn'), 'Назад/Вперёд есть');
    d.getElementById('nextBtn').click();
    ok(T.currentQuestionIndex === 1, 'свободная навигация работает');
    d.getElementById('prevBtn').click();
    ok(T.currentQuestionIndex === 0, 'возврат назад работает');
});

console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
