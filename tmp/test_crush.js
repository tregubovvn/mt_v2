// Интеграционный тест CrushMode через jsdom (без сети)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// Убираем внешние скрипты/ресурсы (MathJax и т.п.)
html = html.replace(/<script[^>]*src=[^>]*><\/script>/g, '');

let alerts = [];
let passed = 0, failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log('  ✔', name); }
    else { failed++; console.log('  ✘ FAIL:', name); }
}

async function run(query) {
    const dom = new JSDOM(html, { url: 'http://localhost/index.html' + query, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.alert = m => alerts.push(String(m));
    w.confirm = () => true;
    w.scrollTo = () => {};
    w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
    w.MathJax = undefined;
    w.eval(appJs + ";window.__startTest = startTest;");
    // Экспортируем нужные функции в window (app.js выполняется как скрипт, let — не в window)
    // Инициализация прошла (DOMContentLoaded или сразу)
    await new Promise(r => setTimeout(r, 20));

    // Загрузка демо-теста напрямую
    w.eval('window.loadExampleTest && window.loadExampleTest();');
    await new Promise(r => setTimeout(r, 30));
    return { dom, w };
}

function visible(id, w) {
    const el = w.document.getElementById(id);
    return el && !el.classList.contains('hidden');
}
function opts(w) { return [...w.document.querySelectorAll('.answer-option')]; }
function clickOption(i, w) { opts(w)[i].dispatchEvent(new w.Event('click', { bubbles: true })); }
function clickById(id, w) { w.document.getElementById(id).dispatchEvent(new w.Event('click', { bubbles: true })); }
function correctIndex(w) {
    // Определяем правильный вариант по данным приложения
    return w.eval(`questions[${w.eval('currentQuestionIndex')}].answers.findIndex(a=>a.isCorrect)`);
}
function wrongIndex(w) {
    return w.eval(`questions[${w.eval('currentQuestionIndex')}].answers.findIndex(a=>!a.isCorrect)`);
}

(async () => {
    // ================= Сценарий 1: чистый CrushMode =================
    console.log('\n=== Сценарий 1: ?CrushMode ===');
    alerts = [];
    let { w } = await run('?CrushMode=true');
    w.eval('window.__startTest()');
    check('Кнопка «Проверить» видима', visible('crushCheckBtn', w));
    check('«Дальше →» скрыта до верного ответа', !visible('crushNextBtn', w));
    check('Обычные «Вперёд»/«Завершить» скрыты', !visible('nextBtn', w) && !visible('finishBtn', w));
    check('Без CheckMode отдельной кнопки в карточке нет', w.document.querySelectorAll('.check-block').length === 0);

    // Проверка без выбора
    clickById('crushCheckBtn', w);
    check('Без выбранного варианта — предупреждение, без роста ошибок',
        alerts.some(a => a.includes('Сначала выберите')) && w.eval('crushErrors') === 0);

    // Неверный ответ -> красный, можно выбрать другой
    const wi = wrongIndex(w), ci = correctIndex(w);
    clickOption(wi, w);
    alerts = [];
    clickById('crushCheckBtn', w);
    check('Неверный подсвечен красным', opts(w)[wi].classList.contains('incorrect'));
    check('Правильный НЕ раскрыт зелёным (нет подсказки)', !opts(w)[ci].classList.contains('correct'));
    check('Сообщение об ошибке + попытки уменьшились',
        alerts.some(a => a.includes('Неверно')) && w.eval('crushErrors') === 1);
    check('«Дальше →» всё ещё скрыта', !visible('crushNextBtn', w));

    // Выбор другого ответа возможен (красный снимается)
    clickOption(ci, w);
    check('Можно выбрать другой ответ после ошибки', opts(w)[ci].classList.contains('selected') && !opts(w)[wi].classList.contains('incorrect'));

    // Верный ответ -> зелёный + «Дальше →»
    alerts = [];
    clickById('crushCheckBtn', w);
    check('Верный подсвечен зелёным', opts(w)[ci].classList.contains('correct'));
    check('Появилась кнопка «Дальше →»', visible('crushNextBtn', w));

    // «Дальше →» -> следующий вопрос
    clickById('crushNextBtn', w);
    check('Переход к вопросу 2', w.eval('currentQuestionIndex') === 1 && w.document.getElementById('currentQuestion').textContent === '2');
    check('На новом вопросе «Дальше →» снова скрыта', !visible('crushNextBtn', w));

    // ===== 3 ошибки -> возврат к началу =====
    // Вопрос 2: три неверных ответа
    for (let k = 0; k < 2; k++) {
        const widx = wrongIndex(w);
        clickOption(widx, w);
        alerts = [];
        clickById('crushCheckBtn', w);
        check(`Ошибка ${k + 1}/3 зафиксирована`, w.eval('crushErrors') === k + 1);
    }
    // Третья ошибка на другом вопросе тоже считается — переходим назад и ошибаемся ещё раз
    const widx = wrongIndex(w);
    clickOption(widx, w);
    alerts = [];
    clickById('crushCheckBtn', w);
    check('Третья ошибка — alert о перезапуске', alerts.some(a => a.includes('заново')));
    check('Возврат к первому вопросу', w.eval('currentQuestionIndex') === 0);
    check('Ошибки сброшены', w.eval('crushErrors') === 0);
    check('Ответы очищены', w.eval('userAnswers.every(a => a === null)'));
    check('Подсчёт результата не сломан (вопросы живые)', w.eval('questions.length') === 3);

    // ================= Сценарий 2: CrushMode + CheckMode =================
    console.log('\n=== Сценарий 2: ?CrushMode&CheckMode ===');
    alerts = [];
    ({ w } = await run('?CrushMode=true&CheckMode=true'));
    w.eval('window.__startTest()');
    check('Кнопка «Проверить ответ» в карточке есть', w.document.querySelectorAll('.check-block').length === 1);
    check('Нижняя кнопка «Проверить» видима', visible('crushCheckBtn', w));
    const ci2 = correctIndex(w), wi2 = wrongIndex(w);
    clickOption(wi2, w);
    alerts = [];
    // Жмём кнопку внутри карточки — она должна работать как проверка CrushMode
    w.document.querySelector('.check-block .btn').dispatchEvent(new w.Event('click', { bubbles: true }));
    check('Через кнопку в карточке: засчитана ошибка', w.eval('crushErrors') === 1);
    check('Неверный красный', opts(w)[wi2].classList.contains('incorrect'));
    clickOption(ci2, w);
    w.document.querySelector('.check-block .btn').dispatchEvent(new w.Event('click', { bubbles: true }));
    check('Верный ответ открыл «Дальше →»', visible('crushNextBtn', w));
    check('Кнопка в карточке не задизейблена (можно листать)', !w.document.querySelector('.check-block .btn').disabled);

    // ================= Сценарий 3: обычный режим =================
    console.log('\n=== Сценарий 3: без флагов ===');
    ({ w } = await run(''));
    w.eval('window.__startTest()');
    check('Кнопки CrushMode скрыты', !visible('crushCheckBtn', w) && !visible('crushNextBtn', w));
    check('«Вперёд»/«Завершить» видимы', visible('nextBtn', w) && visible('finishBtn', w));
    clickById('nextBtn', w);
    check('Обычная навигация работает', w.eval('currentQuestionIndex') === 1);

    // ================= Сценарий 4: только CheckMode =================
    console.log('\n=== Сценарий 4: ?CheckMode ===');
    ({ w } = await run('?CheckMode=true'));
    w.eval('window.__startTest()');
    check('Кнопка «Проверить ответ» видима', w.document.querySelectorAll('.check-block').length === 1);
    const ci4 = correctIndex(w), wi4 = wrongIndex(w);
    clickOption(wi4, w);
    w.document.querySelector('.check-block .btn').dispatchEvent(new w.Event('click', { bubbles: true }));
    check('Показан правильный вариант зелёным', opts(w)[ci4].classList.contains('correct'));
    check('Выбранный неверный — красный', opts(w)[wi4].classList.contains('incorrect'));
    check('После проверки менять ответ нельзя', (clickOption(ci4, w), !opts(w)[ci4].classList.contains('selected')));
    check('Фидбек с правильным ответом выведен', w.document.querySelector('.check-feedback').textContent.includes('Правильный ответ'));

    console.log(`\nИТОГ: ${passed} пройдено, ${failed} провалено`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
