// Интеграционный тест приложения тестирования: все типы вопросов + режимы
const { JSDOM } = require('jsdom');
const fs = require('fs');

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
  <question type="category"><category><text>Cat</text></category></question>
  <question type="multichoice">
    <name><text>Одиночный выбор</text></name>
    <single>true</single>
    <questiontext><text>2+2=?</text></questiontext>
    <answer fraction="100"><text>4</text></answer>
    <answer fraction="0"><text>5</text></answer>
  </question>
  <question type="multichoice">
    <name><text>Множественный выбор</text></name>
    <single>false</single>
    <questiontext><text>Чётные числа?</text></questiontext>
    <answer fraction="50"><text>2</text></answer>
    <answer fraction="50"><text>4</text></answer>
    <answer fraction="0"><text>5</text></answer>
  </question>
  <question type="truefalse">
    <name><text>Верно неверно</text></name>
    <questiontext><text>Земля круглая?</text></questiontext>
    <answer fraction="100"><text>true</text></answer>
    <answer fraction="0"><text>false</text></answer>
  </question>
  <question type="shortanswer">
    <name><text>Короткий ответ</text></name>
    <questiontext><text>Столица России?</text></questiontext>
    <answer fraction="100"><text>Москва</text></answer>
    <answer fraction="100"><text>Moscow</text></answer>
  </question>
  <question type="numerical">
    <name><text>Числовой</text></name>
    <questiontext><text>Сколько будет 2*3?</text></questiontext>
    <answer fraction="100"><text>6</text><tolerance>0.01</tolerance></answer>
  </question>
  <question type="cloze">
    <name><text>Клоуз</text></name>
    <questiontext format="html"><text><![CDATA[В стоке <select> и <input>: Москва — {...:MCMS:столица%100%|Москва%100~город%0} и число {...:NUMERICAL:6&0.1}.]]></text></questiontext>
  </question>
  <question type="description">
    <name><text>Инструкция</text></name>
    <questiontext><text>Прочитайте инструкцию.</text></questiontext>
  </question>
</quiz>`;

const html = fs.readFileSync('/workspace/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.alert = () => {};
w.confirm = () => true;

// Собираем код приложения и тестовый сценарий в ОДИН eval, чтобы видеть
// let-переменные области видимости скрипта
let code = fs.readFileSync('/workspace/app.js', 'utf8');
const testCode = `
(function(){
  const R = [];
  function t(name, cond){ R.push([name, !!cond]); }
  // парсинг
  questions = [];
  parseMoodleXML(${JSON.stringify(XML)});
  t('parsed 7 questions', questions.length === 7);
  t('types', ['multichoice','multichoice','truefalse','shortanswer','numerical','cloze','description'].join()===questions.map(q=>q.type).join());
  t('multi single=false', questions[1].single===false);
  t('cloze blanks=2', questions[5].clozeBlanks && questions[5].clozeBlanks.length===2);
  t('tf correct=true', questions[2].answers[0].isCorrect===true);
  t('num tolerance', questions[4].answers[0].tolerance===0.01);

  // запуск теста
  randomMode=false; crushMode=false; checkMode=true;
  startTest();
  t('start idx0', currentQuestionIndex===0);

  // Q0 одиночный: выбрать верный (индекс может перемешаться) -> проверить
  function pickAndCheck(correctTextFilter){
    const q = questions[currentQuestionIndex];
    let i = q.answers.findIndex(correctTextFilter);
    selectAnswer(i);
    return handleCheckClick();
  }
  // одиночный — верно
  selectAnswer(questions[0].answers.findIndex(a=>a.isCorrect));
  handleCheckClick();
  t('q0 checked correct', questions[0]._checked===true && questions[0].isCorrect===true);
  t('q0 locked after check', checkMode && checkedQuestions[0]===true);
  // попытка изменить после фиксации
  const before = userAnswers[0];
  selectAnswer(0); selectAnswer(1);
  t('q0 answer locked', userAnswers[0]===before);

  // Q1 множественный выбор: отметить 2 и 4 -> верно; потом ошибка на другом варианте
  goToQuestion(1);
  const q1 = questions[1];
  const i2 = q1.answers.findIndex(a=>a.text==='2'), i4 = q1.answers.findIndex(a=>a.text==='4'), i5 = q1.answers.findIndex(a=>a.text==='5');
  selectAnswer(i2); selectAnswer(i4);
  t('multi sel array', Array.isArray(userAnswers[1]) && userAnswers[1].length===2);
  handleCheckClick();
  t('multi correct', questions[1].isCorrect===true);

  // Q2 truefalse
  goToQuestion(2);
  selectAnswer(questions[2].answers.findIndex(a=>a.isCorrect));
  handleCheckClick();
  t('tf correct', questions[2].isCorrect===true);

  // Q3 shortanswer — ведём текст
  goToQuestion(3);
  userTextAnswers[3]='москва';   // нормализация регистра
  t('short match case-insens', evaluateQuestion(questions[3],3).correct===true);
  userTextAnswers[3]='питер';
  t('short wrong', evaluateQuestion(questions[3],3).correct===false);

  // Q4 numerical допуск
  goToQuestion(4);
  userTextAnswers[4]='6.005';
  t('num within tolerance', evaluateQuestion(questions[4],4).correct===true);
  userTextAnswers[4]='7';
  t('num out of tolerance', evaluateQuestion(questions[4],4).correct===false);

  // Q5 cloze
  goToQuestion(5);
  userClozeAnswers[5]={0:'столица',1:'6'};
  t('cloze all correct', evaluateQuestion(questions[5],5).correct===true);
  userClozeAnswers[5]={0:'город',1:'6'};
  t('cloze one wrong', evaluateQuestion(questions[5],5).correct===false);
  userClozeAnswers[5]={0:'столица'};
  t('cloze incomplete -> answered but wrong', hasAnswer(5)===true && evaluateQuestion(questions[5],5).correct===false);

  // Q6 description — «отвечен» автоматически
  goToQuestion(6);
  t('description answered', hasAnswer(6)===true && evaluateQuestion(questions[6],6).correct===true);

  // finishTest подсчёт
  // восстановим правильные ответы для честной оценки
  userTextAnswers[3]='Москва'; userTextAnswers[4]='6'; userClozeAnswers[5]={0:'столица',1:'6'};
  finishTest();
  t('results shown', !resultsSection.classList.contains('hidden'));
  t('score text', scoreElement.textContent==='100%');

  // ===== CrushMode по всем типам =====
  questions=[]; parseMoodleXML(${JSON.stringify(XML)});
  checkMode=false; crushMode=true; randomMode=false;
  startTest();
  t('crush prev hidden', prevBtn.classList.contains('hidden'));
  t('crush next hidden before correct', nextBtn.classList.contains('hidden'));
  t('crush check visible', !checkAnswerBtn.classList.contains('hidden'));
  // неверный ответ на Q0
  const q0=questions[0];
  selectAnswer(q0.answers.findIndex(a=>!a.isCorrect));
  handleCheckClick();
  t('crush error counted', crushErrors===1);
  t('crush still answering', crushState===CRUSH_STATE.ANSWERING);
  // верный
  selectAnswer(q0.answers.findIndex(a=>a.isCorrect));
  handleCheckClick();
  t('crush correct state', crushState===CRUSH_STATE.CORRECT);
  t('crush next visible now', !nextBtn.classList.contains('hidden') && nextBtn.textContent.includes('Дальше'));
  handleNext();
  t('crush advanced', currentQuestionIndex===1);
  // --- мног. выбор в crush: частичный ответ -> ошибка, полный -> верно (индекс-безопасно) ---
  {
    const q1 = questions[1];
    const okIdxs = () => q1.answers.map((a,i)=>a.isCorrect?i:-1).filter(i=>i>=0);
    selectAnswer(okIdxs()[0]);            // только один верный — неполный ответ
    handleCheckClick();
    t('crush multi error', crushErrors===2 && crushState===CRUSH_STATE.ANSWERING);
    okIdxs().forEach(i => { if (!(userAnswers[1]||[]).includes(i)) selectAnswer(i); });
    handleCheckClick();
    t('crush multi correct', crushState===CRUSH_STATE.CORRECT);
  }
  // --- прохождение оставшихся вопросов «в верном порядке» до truefalse (q2) ---
  function correctNow() {
    const i = currentQuestionIndex, q = questions[i];
    switch (q.type) {
      case 'multichoice':
        if (!q.single) { q.answers.forEach((a,idx)=>{ if(a.isCorrect && !(userAnswers[i]||[]).includes(idx)) selectAnswer(idx); }); }
        else { const idx=q.answers.findIndex(a=>a.isCorrect); if(userAnswers[i]!==idx) selectAnswer(idx); }
        break;
      case 'truefalse': { const idx=q.answers.findIndex(a=>a.isCorrect); if(userAnswers[i]!==idx) selectAnswer(idx); break; }
      case 'shortanswer': userTextAnswers[i]=q.answers.find(a=>a.isCorrect).text; break;
      case 'numerical':   userTextAnswers[i]=q.answers[0].text; break;
      case 'cloze': {
        const m={}; q.clozeBlanks.forEach((b,bi)=>{ b.type==='MCMS' ? m[bi]=(b.answers.find(a=>a.correct)||{}).text : m[bi]=b.answers[0].text; });
        userClozeAnswers[i]=m; break; }
    }
  }
  // дойти до вопроса 'Верно неверно' (truefalse), отвечая верно и нажимая «Дальше →»
  let guard=0;
  while (guard++ < 20 && !(questions[currentQuestionIndex].type==='truefalse')) {
    if (crushState!==CRUSH_STATE.CORRECT){ correctNow(); handleCheckClick(); }
    if (crushState===CRUSH_STATE.CORRECT){ handleNext(); }
  }
  t('reached truefalse question', questions[currentQuestionIndex].type==='truefalse');
  // --- третья ошибка (заведомо неверный ответ на truefalse) -> возврат к началу ---
  {
    const q2 = questions[currentQuestionIndex];
    selectAnswer(q2.answers.findIndex(a=>!a.isCorrect));
    handleCheckClick();
    t('crush restarted at 0 after 3rd error', currentQuestionIndex===0 && crushErrors===0 && crushState===CRUSH_STATE.ANSWERING);
    t('crush answers cleared', userAnswers.every(a=>a===null||(Array.isArray(a)&&a.length===0)) && userTextAnswers.every(v=>!v));
  }

  return R;
})();`;

const results = w.eval(code + '\n' + testCode);
let fails = 0;
for (const [name, ok] of results) {
    console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name);
    if (!ok) fails++;
}
console.log(fails === 0 ? 'ALL_TESTS_PASSED' : `${fails} TESTS FAILED`);
process.exit(fails === 0 ? 0 : 1);
