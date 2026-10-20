// Moodle XML Тестирование — логика приложения (извлечена из index.html при рефакторинге)
'use strict';
// =============================================================
// Константы
// =============================================================
const CRUSH_MAX_ERRORS = 3; // максимум ошибок за одну сессию в CrushMode
const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];
const YANDEX_API_PREFIX = 'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=';
const STORAGE_KEY_STUDENT = 'quizStudent';
const SCORE_RING_LENGTH = 440;      // длина окружности индикатора результата (2·π·70)
const GRADE_THRESHOLDS = [          // процент правильных ответов -> оценка по 5-балльной шкале
    { min: 85, grade: 5 },
    { min: 70, grade: 4 },
    { min: 50, grade: 3 },
];

// Состояния кнопки «Вперёд» в CrushMode
const CRUSH_STATE = { ANSWERING: 'answering', ADVANCING: 'advancing', RESTART: 'restart' };

// Демо-тест (вставляется в редактор/загружается по кнопке «Демо-тест»)
const DEMO_QUIZ_XML = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
    <topicName>Демо: формулы и таблицы</topicName>
    <question type="multichoice">
        <name><text>Пример с формулой 1</text></name>
        <questiontext format="html">
            <text><![CDATA[<p>Выберите правильную формулу для расчёта коэффициента:</p><p>\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{сэ}}}{\\text{АД}_{\\text{с}}}\\)</p>]]></text>
        </questiontext>
        <answer fraction="100"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{сэ}}}{\\text{АД}_{\\text{с}}}\\)]]></text></answer>
        <answer fraction="0"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{с}}}{\\text{АД}_{\\text{сэ}}}\\)]]></text></answer>
        <answer fraction="0"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\text{АД}_{\\text{сэ}} + \\text{АД}_{\\text{с}}\\)]]></text></answer>
    </question>
    <question type="multichoice">
        <name><text>Пример с формулой 2</text></name>
        <questiontext format="html">
            <text><![CDATA[<p>Чему равно значение \\(E = mc^2\\) при m = 2, c = 3?</p>]]></text>
        </questiontext>
        <answer fraction="0"><text>6</text></answer>
        <answer fraction="100"><text>18</text></answer>
        <answer fraction="0"><text>12</text></answer>
    </question>
    <question type="multichoice">
        <name><text>Пример с таблицей</text></name>
        <questiontext format="html">
            <text><![CDATA[<table border="1"><tr><th>Ячейка</th><th>Показатель</th><th>Обозначение</th><th>Значение</th><th>Единицы измерения</th></tr><tr><td>A1</td><td>?</td><td>Q</td><td>—</td><td>—</td></tr></table><p>Какой показатель должен находиться в ячейке A1?</p>]]></text>
        </questiontext>
        <answer fraction="100"><text><![CDATA[<p>Объёмный расход</p>]]></text></answer>
        <answer fraction="0"><text><![CDATA[<p>Давление</p>]]></text></answer>
        <answer fraction="0"><text><![CDATA[<p>Температура</p>]]></text></answer>
    </question>
</quiz>`;

// =============================================================
// Состояние приложения
// =============================================================
let questions = [];           // распарсенные вопросы [{name, text, answers:[{text,isCorrect}], isCorrect, _checked}]
let currentQuestionIndex = 0;
let userAnswers = [];         // индекс выбранного варианта для каждого вопроса (null — нет ответа)
let timerInterval = null;
let timeSpent = 0;            // секунды с момента старта теста
let studentName = '';
let pendingStartAfterName = false; // автозагрузка ждёт подтверждения ФИО
let qrScannerActive = false;
let videoStream = null;
let checkMode = false;        // CheckMode=true   — мгновенная проверка + случайный порядок вопросов
let crushMode = false;        // CrushMode=true   — проверка при переходе, 3 ошибки = старт заново
let headerShow = false;       // HeaderShow=true  — показывать заголовок вопроса из <name>
let crushState = CRUSH_STATE.ANSWERING;
let crushErrors = 0;          // сколько ошибок сделано в текущей сессии (CrushMode)
let checkedQuestions = [];    // какие вопросы уже проверены (CheckMode)
let feedbackStore = [];       // {ok, correctTexts} для восстановления фидбэка при навигации (CheckMode)
let testTopicName = '';       // содержимое <topicName> из XML (если есть)

// ===== Элементы DOM =====
const uploadSection = document.getElementById('uploadSection');
const urlInput = document.getElementById('urlInput');
const loadUrlBtn = document.getElementById('loadUrlBtn');
const qrCodeBtn = document.getElementById('qrCodeBtn');
const yandexBtn = document.getElementById('yandexBtn');
const demoBtn = document.getElementById('demoBtn');
const uploadStatus = document.getElementById('uploadStatus');
const testSection = document.getElementById('testSection');
const timerElement = document.getElementById('timer');
const currentQuestionElement = document.getElementById('currentQuestion');
const totalQuestionsElement = document.getElementById('totalQuestions');
const progressFill = document.getElementById('progressFill');
const questionsContainer = document.getElementById('questionsContainer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const finishBtn = document.getElementById('finishBtn');
const resultsSection = document.getElementById('resultsSection');
const resultsSummary = document.getElementById('resultsSummary');
const resultAvatar = document.getElementById('resultAvatar');
const resultStudentName = document.getElementById('resultStudentName');
const scoreRing = document.getElementById('scoreRing');
const scoreElement = document.getElementById('score');
const gradePill = document.getElementById('gradePill');
const correctAnswersElement = document.getElementById('correctAnswers');
const totalAnswersElement = document.getElementById('totalAnswers');
const timeSpentElement = document.getElementById('timeSpent');
const restartBtn = document.getElementById('restartBtn');
const changeNameBtn = document.getElementById('changeNameBtn');
const detailedResults = document.getElementById('detailedResults');
const studentChip = document.getElementById('studentChip');
const chipAvatar = document.getElementById('chipAvatar');
const chipName = document.getElementById('chipName');
const welcomeOverlay = document.getElementById('welcomeOverlay');
const lastNameInput = document.getElementById('lastNameInput');
const firstNameInput = document.getElementById('firstNameInput');
const middleNameInput = document.getElementById('middleNameInput');
const nameError = document.getElementById('nameError');
const confirmNameBtn = document.getElementById('confirmNameBtn');
const qrModal = document.getElementById('qrModal');
const qrVideo = document.getElementById('qrVideo');
const qrStatus = document.getElementById('qrStatus');
const closeQrBtn = document.getElementById('closeQrBtn');
const checkBadge = document.getElementById('checkBadge');
const crushBadge = document.getElementById('crushBadge');
const headerBadge = document.getElementById('headerBadge');
const crushAttemptsPill = document.getElementById('crushAttemptsPill');

// ===== Вспомогательные функции =====
function isAnyOverlayOpen() {
    return !welcomeOverlay.classList.contains('hidden') ||
           !qrModal.classList.contains('hidden');
}

function updateScrollLock() {
    document.body.style.overflow = isAnyOverlayOpen() ? 'hidden' : 'auto';
}

function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function friendlyError(error) {
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
        return new Error('Не удалось загрузить файл. Проверьте ссылку, доступность файла и разрешения CORS на сервере.');
    }
    return error;
}

function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

function showUploadStatus(message, type) {
    uploadStatus.textContent = message;
    uploadStatus.className = 'status-message';
    if (type) uploadStatus.classList.add(type);
    uploadStatus.classList.remove('hidden');
}

function applyMathJax() {
    if (window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetPromise().catch(err => console.log('Ошибка MathJax: ' + err.message));
    }
}

// ===== Определение типа контента =====
// Есть ли в строке HTML-теги
function containsHtml(str) {
    return /<\/?[a-z][^>]*>/i.test(str || '');
}

// Есть ли в строке LaTeX-разделители
function containsMath(str) {
    const t = str || '';
    return t.includes('\\(') || t.includes('\\[');
}

// Однократное декодирование HTML-сущностей (&lt; &gt; &amp; ...)
function decodeEntities(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
}

// Защита угловых скобок внутри LaTeX (\( a < b \) не должна превратиться в тег)
function protectMathAngles(html) {
    return html.replace(/(\\[\(\[][\s\S]*?\\[\)\]])/g, seg =>
        seg.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    );
}

// ===== Логика ФИО =====
function getFullName() {
    return [lastNameInput.value.trim(), firstNameInput.value.trim(), middleNameInput.value.trim()]
        .filter(Boolean).join(' ');
}

function updateStudentUI() {
    const parts = studentName.split(' ').filter(Boolean);
    const initials = ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
    chipAvatar.textContent = initials || '—';
    chipName.textContent = parts.length > 1
        ? `${parts[0]} ${parts[1][0]}.` : studentName;
    studentChip.classList.remove('hidden');
    resultStudentName.textContent = studentName;
    resultAvatar.textContent = initials || '—';
}

function confirmName() {
    const l = lastNameInput.value.trim();
    const f = firstNameInput.value.trim();
    nameError.classList.add('hidden');
    if (l.length < 2 || f.length < 2) {
        nameError.textContent = 'Пожалуйста, укажите фамилию и имя (минимум 2 символа)';
        nameError.classList.remove('hidden');
        return;
    }
    studentName = getFullName();
    try {
        localStorage.setItem('quizStudent', JSON.stringify({
            l, f, m: middleNameInput.value.trim()
        }));
    } catch (e) { console.warn('localStorage недоступен', e); }
    updateStudentUI();
    welcomeOverlay.classList.add('hidden');
    updateScrollLock();

    if (pendingStartAfterName && questions.length > 0) {
        pendingStartAfterName = false;
        startTest();
    } else if (!uploadSection.classList.contains('hidden')) {
        urlInput.focus();
    }
}

function openNameOverlay() {
    try {
        const saved = JSON.parse(localStorage.getItem('quizStudent') || 'null');
        if (saved) {
            lastNameInput.value = saved.l || '';
            firstNameInput.value = saved.f || '';
            middleNameInput.value = saved.m || '';
        }
    } catch (e) {}
    pendingStartAfterName = false;
    nameError.classList.add('hidden');
    welcomeOverlay.classList.remove('hidden');
    updateScrollLock();
}

// ===== Чтение параметров из адресной строки =====
function getTestUrlFromLocation() {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get('name') || params.get('test') || params.get('url') || '';
    } catch (e) {
        console.error('Ошибка парсинга URL параметров:', e);
        return '';
    }
}

// Универсальное чтение флага режима (CheckMode, CrushMode, HeaderShow и т.п.)
function getUrlFlag(name) {
    try {
        const params = new URLSearchParams(window.location.search);
        for (const [key, value] of params.entries()) {
            if (key.toLowerCase() === name.toLowerCase()) {
                // поддерживаем: ?CrushMode, ?CrushMode=true / 1 / yes
                return value === '' || ['true', '1', 'yes'].includes(value.toLowerCase());
            }
        }
    } catch (e) {
        console.error('Ошибка парсинга URL параметров:', e);
    }
    return false;
}

// ===== Загрузка и парсинг теста =====
async function fetchAndParseTest(url) {
    let target = url;

    if (url.includes('yadi.sk') || url.includes('disk.yandex')) {
        const resp = await fetch(YANDEX_API_PREFIX + encodeURIComponent(url));
        if (!resp.ok) {
            if (resp.status === 403) throw new Error('403: Доступ запрещён. Проверьте права доступа к файлу');
            if (resp.status === 404) throw new Error('404: Файл не найден. Проверьте ссылку и права доступа');
            throw new Error(`Ошибка HTTP: ${resp.status}`);
        }
        const data = await resp.json();
        if (!data.href) throw new Error('Не удалось получить ссылку для скачивания с Яндекс.Диска');
        target = data.href;
    }

    const response = await fetch(target);
    if (!response.ok) throw new Error(`Ошибка HTTP: ${response.status}`);
    const xmlContent = await response.text();
    parseMoodleXML(xmlContent);

    if (questions.length === 0) {
        throw new Error('Не удалось найти вопросы в XML файле');
    }
}

async function autoLoadTest(url) {
    try {
        await fetchAndParseTest(url);
        console.log(`Автоматически загружен тест с ${questions.length} вопросами`);
        uploadSection.classList.add('hidden');
        if (studentName) {
            startTest();
        } else {
            pendingStartAfterName = true;
        }
    } catch (error) {
        const err = friendlyError(error);
        console.error('Ошибка автозагрузки теста:', err);
        uploadSection.classList.remove('hidden');
        urlInput.value = url;
        showUploadStatus(`Ошибка загрузки: ${err.message}`, 'error');
    }
}

// ===== Демо-тест =====
window.loadExampleTest = function () {
    const exampleXML = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
    <topicName>Демо: формулы и таблицы</topicName>
    <question type="multichoice">
<name><text>Пример с формулой 1</text></name>
<questiontext format="html">
    <text><![CDATA[<p>Выберите правильную формулу для расчёта коэффициента:</p><p>\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{сэ}}}{\\text{АД}_{\\text{с}}}\\)</p>]]></text>
</questiontext>
<answer fraction="100"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{сэ}}}{\\text{АД}_{\\text{с}}}\\)]]></text></answer>
<answer fraction="0"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{с}}}{\\text{АД}_{\\text{сэ}}}\\)]]></text></answer>
<answer fraction="0"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\text{АД}_{\\text{сэ}} + \\text{АД}_{\\text{с}}\\)]]></text></answer>
    </question>
    <question type="multichoice">
<name><text>Пример с формулой 2</text></name>
<questiontext format="html">
    <text><![CDATA[<p>Чему равно значение \\(E = mc^2\\) при m = 2, c = 3?</p>]]></text>
</questiontext>
<answer fraction="0"><text>6</text></answer>
<answer fraction="100"><text>18</text></answer>
<answer fraction="0"><text>12</text></answer>
    </question>
    <question type="multichoice">
<name><text>Пример с таблицей</text></name>
<questiontext format="html">
    <text><![CDATA[<table border="1"><tr><th>Ячейка</th><th>Показатель</th><th>Обозначение</th><th>Значение</th><th>Единицы измерения</th></tr><tr><td>A1</td><td>?</td><td>Q</td><td>—</td><td>—</td></tr></table><p>Какой показатель должен находиться в ячейке A1?</p>]]></text>
</questiontext>
<answer fraction="100"><text><![CDATA[<p>Объёмный расход</p>]]></text></answer>
<answer fraction="0"><text><![CDATA[<p>Давление</p>]]></text></answer>
<answer fraction="0"><text><![CDATA[<p>Температура</p>]]></text></answer>
    </question>
</quiz>`;
    parseMoodleXML(exampleXML);
    if (questions.length > 0) {
        showUploadStatus(`Загружен демо-тест с ${questions.length} вопросами`, 'success');
        setTimeout(() => { uploadStatus.classList.add('hidden'); startTest(); }, 1200);
    }
};

// ===== Ручная загрузка по URL =====
async function handleUrlLoad() {
    const url = urlInput.value.trim();
    if (!url) { showUploadStatus('Пожалуйста, введите URL XML файла', 'error'); return; }
    if (!isValidUrl(url)) { showUploadStatus('Пожалуйста, введите корректный URL', 'error'); return; }
    if (!url.toLowerCase().includes('.xml')) {
        if (!confirm('URL не заканчивается на .xml. Продолжить загрузку?')) return;
    }
    try {
        showUploadStatus('Загрузка теста...', 'loading');
        loadUrlBtn.disabled = true;
        qrCodeBtn.disabled = true;
        yandexBtn.disabled = true;
        demoBtn.disabled = true;
        loadUrlBtn.textContent = 'Загрузка...';

        await fetchAndParseTest(url);

        showUploadStatus(`Успешно загружен тест с ${questions.length} вопросами`, 'success');
        setTimeout(() => { uploadStatus.classList.add('hidden'); startTest(); }, 1200);
    } catch (error) {
        const err = friendlyError(error);
        console.error('Ошибка загрузки теста:', err);
        showUploadStatus(`Ошибка загрузки: ${err.message}`, 'error');
    } finally {
        loadUrlBtn.disabled = false;
        qrCodeBtn.disabled = false;
        yandexBtn.disabled = false;
        demoBtn.disabled = false;
        loadUrlBtn.textContent = '🔗 Загрузить';
    }
}

function handleYandexLoad() {
    const link = prompt('Вставьте публичную ссылку на XML-файл на Яндекс.Диске:', urlInput.value);
    if (!link) return;
    urlInput.value = link.trim();
    handleUrlLoad();
}

// ===== QR-сканер =====
async function startQRScanner() {
    if (typeof jsQR !== 'function') {
        showUploadStatus('Библиотека сканирования не загрузилась. Введите ссылку вручную.', 'error');
        return;
    }
    qrModal.classList.remove('hidden');
    updateScrollLock();
    qrScannerActive = true;
    qrStatus.textContent = 'Запуск камеры...';
    qrStatus.style.color = '';

    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        qrVideo.srcObject = videoStream;
        qrVideo.setAttribute('playsinline', true);
        await qrVideo.play();
        qrStatus.textContent = 'Наведите камеру на QR-код';
        qrStatus.style.color = '';
        requestAnimationFrame(scanQRCode);
    } catch (error) {
        console.error('Ошибка доступа к камере:', error);
        qrStatus.textContent = 'Ошибка доступа к камере. Разрешите доступ в настройках браузера или введите ссылку вручную в поле выше.';
        qrStatus.style.color = 'red';
    }
}

function scanQRCode() {
    if (!qrScannerActive) return;
    if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
        const canvas = document.createElement('canvas');
        canvas.width = qrVideo.videoWidth;
        canvas.height = qrVideo.videoHeight;
        const context = canvas.getContext('2d');
        context.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
        });
        if (code && code.data) {
            qrStatus.textContent = 'QR-код распознан!';
            qrStatus.style.color = 'green';
            urlInput.value = code.data;
            setTimeout(() => {
                stopQRScanner();
                showUploadStatus('Ссылка из QR-кода вставлена', 'success');
                setTimeout(() => uploadStatus.classList.add('hidden'), 2500);
            }, 800);
            return;
        }
    }
    if (qrScannerActive) requestAnimationFrame(scanQRCode);
}

function stopQRScanner() {
    qrScannerActive = false;
    qrModal.classList.add('hidden');
    updateScrollLock();
    qrStatus.textContent = 'Наведите камеру на QR-код';
    qrStatus.style.color = '';
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    if (qrVideo.srcObject) qrVideo.srcObject = null;
}

// ===== Парсинг Moodle XML =====
function parseMoodleXML(xmlContent) {
    questions = [];
    testTopicName = '';
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

    // Название темы: тег <topicName> (берём первое вхождение в файле, если оно есть)
    const topicNodes = xmlDoc.getElementsByTagName('topicName');
    if (topicNodes.length > 0) {
        const tn = (topicNodes[0].textContent || '').trim();
        if (tn) testTopicName = tn;
    }

    const questionNodes = xmlDoc.getElementsByTagName('question');

    for (let node of questionNodes) {
        const type = node.getAttribute('type');
        if (type !== 'multichoice') continue;

        // Название вопроса из тега <name> (для режима HeaderShow)
        let questionName = '';
        const nameNodes = node.getElementsByTagName('name');
        if (nameNodes.length > 0) {
            const nameTextNodes = nameNodes[0].getElementsByTagName('text');
            if (nameTextNodes.length > 0) questionName = nameTextNodes[0].textContent.trim();
        }

        // Текст вопроса
        let questionText = '';
        const questionTextNodes = node.getElementsByTagName('questiontext');
        if (questionTextNodes.length > 0) {
            const textNodes = questionTextNodes[0].getElementsByTagName('text');
            if (textNodes.length > 0) questionText = textNodes[0].textContent.trim();
        }
        if (!questionText) continue;
        questionText = processHtmlContent(questionText);

        // Варианты ответа
        const answers = [];
        const answerNodes = node.getElementsByTagName('answer');
        for (let answerNode of answerNodes) {
            let answerText = '';
            const textNodes = answerNode.getElementsByTagName('text');
            if (textNodes.length > 0) answerText = textNodes[0].textContent.trim();
            if (!answerText) continue;
            answerText = processHtmlContent(answerText);
            const fraction = parseFloat(answerNode.getAttribute('fraction') || 0);
            answers.push({ text: answerText, isCorrect: fraction > 0 });
        }

        if (answers.length === 0) continue;
        questions.push({ name: questionName, text: questionText, answers, isCorrect: false, _checked: false });
    }
    console.log(`Найдено ${questions.length} вопросов` + (testTopicName ? `, тема: ${testTopicName}` : ''));
}

// Обработка HTML-содержимого из CDATA:
// убираем CDATA-обёртки, декодируем двойное экранирование,
// чистим параграфы и нормализуем <br>
function processHtmlContent(content) {
    let c = content || '';
    c = c.replace(/<!\[CDATA\[|\]\]>/g, '');

    // Если есть HTML-сущности — декодируем их один раз.
    // Это разворачивает двойное экранирование (&lt;table&gt; -> <table>)
    // и корректно показывает спецсимволы (&nbsp; -> пробел и т.п.)
    if (/&(lt|gt|amp|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/i.test(c)) {
        const decoded = decodeEntities(c);
        if (containsHtml(decoded) || !containsHtml(c)) {
            c = decoded;
        }
    }

    c = c.replace(/<\/?p(\s[^>]*)?>/gi, '');  // <p> и <p class="...">
    c = c.replace(/<br\s*\/?>/gi, '<br>');
    return c.trim();
}

// Универсальный рендерер текста вопроса/ответа:
// HTML (таблицы, картинки, списки) и/или LaTeX — через innerHTML,
// простой текст — через textContent (защита от случайной разметки)
function renderTextWithMath(text) {
    const container = document.createElement('div');
    container.className = 'formula-container';
    const t = text || '';

    if (containsHtml(t) || containsMath(t)) {
        container.innerHTML = containsMath(t) ? protectMathAngles(t) : t;
    } else {
        container.textContent = t;
    }
    return container;
}

// ===== Перемешивание вопросов =====
// Используется только в режиме CheckMode — там порядок вопросов случайный.
// В остальных режимах вопросы идут последовательно от первого
function shuffleQuestions() {
    for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
    }
}

// ===== Перемешивание вариантов ответов =====
// Выполняется во всех режимах — варианты всегда выводятся случайным образом
function shuffleAnswers() {
    questions.forEach(q => {
        for (let i = q.answers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [q.answers[i], q.answers[j]] = [q.answers[j], q.answers[i]];
        }
    });
}

// ===== Запуск теста =====
function startTest() {
    if (questions.length === 0) return;

    // Сброс состояния
    currentQuestionIndex = 0;
    userAnswers = new Array(questions.length).fill(null);
    checkedQuestions = new Array(questions.length).fill(false);
    feedbackStore = new Array(questions.length).fill(null);
    questions.forEach(q => { q.isCorrect = false; q._checked = false; });
    crushErrors = 0;
    crushState = 'answering';
    timeSpent = 0;
    startTime = Date.now();

    // Порядок вопросов: в CheckMode — случайный, в остальных режимах —
    // последовательно от первого (как в XML)
    if (checkMode) shuffleQuestions();

    // Варианты ответов перемешиваются во всех режимах
    shuffleAnswers();

    // Таймер
    if (timerInterval) clearInterval(timerInterval);
    timerElement.textContent = '00:00:00';
    timerInterval = setInterval(() => {
        timeSpent++;
        timerElement.textContent = formatTime(timeSpent);
    }, 1000);

    // Настройка интерфейса
    uploadSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    testSection.classList.remove('hidden');

    totalQuestionsElement.textContent = questions.length;
    nextBtn.textContent = crushMode ? 'Проверить →' : 'Вперёд →';
    updateCrushAttemptsPill();

    renderQuestion();
    updateScrollLock();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateCrushAttemptsPill() {
    if (!crushMode) return;
    crushAttemptsPill.textContent = `🎯 Осталось попыток: ${Math.max(0, CRUSH_MAX_ERRORS - crushErrors)}`;
}

// ===== Отрисовка текущего вопроса =====
function renderQuestion() {
    const q = questions[currentQuestionIndex];
    questionsContainer.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'question';

    // Заголовок вопроса (HeaderShow=true)
    if (headerShow && q.name) {
        const headerEl = document.createElement('div');
        headerEl.className = 'question-header';
        headerEl.appendChild(renderTextWithMath(q.name));
        card.appendChild(headerEl);
    }

    // Текст вопроса (HTML + LaTeX)
    const textEl = document.createElement('div');
    textEl.className = 'question-text';
    textEl.appendChild(renderTextWithMath(q.text));
    card.appendChild(textEl);

    // Варианты ответа
    q.answers.forEach((answer, i) => {
        const option = document.createElement('div');
        option.className = 'answer-option';
        option.dataset.index = i;

        const letter = document.createElement('div');
        letter.className = 'answer-letter';
        letter.textContent = LETTERS[i] || (i + 1);

        const content = renderTextWithMath(answer.text);

        option.appendChild(letter);
        option.appendChild(content);

        // Восстановление выбранного/проверенного состояния
        if (userAnswers[currentQuestionIndex] === i) option.classList.add('selected');
        if (isChecked(currentQuestionIndex)) {
            const sel = userAnswers[currentQuestionIndex];
            if (crushMode) {
                // CrushMode: правильный ответ не раскрываем.
                // Зелёным — только найденный пользователем верный вариант,
                // красным — его же неверный выбор
                if (q.isCorrect && answer.isCorrect) option.classList.add('correct');
                else if (!q.isCorrect && i === sel) option.classList.add('incorrect');
            } else {
                if (answer.isCorrect) option.classList.add('correct');
                else if (i === sel) option.classList.add('incorrect');
            }
        }

        option.addEventListener('click', () => selectAnswer(i));
        card.appendChild(option);
    });

    // Блок проверки (CheckMode) — кнопка «Проверить ответ»
    if (checkMode) {
        const checkBlock = document.createElement('div');
        checkBlock.className = 'check-block';
        const checkBtn = document.createElement('button');
        checkBtn.className = 'btn btn-dark';
        checkBtn.textContent = '🔍 Проверить ответ';
        checkBtn.addEventListener('click', checkCurrentAnswer);
        if (isChecked(currentQuestionIndex)) checkBtn.disabled = true;
        checkBlock.appendChild(checkBtn);

        const feedback = document.createElement('div');
        feedback.className = 'check-feedback';
        restoreFeedback(currentQuestionIndex, feedback);
        checkBlock.appendChild(feedback);

        card.appendChild(checkBlock);
    }

    questionsContainer.appendChild(card);

    // Обновление счётчиков и навигации
    currentQuestionElement.textContent = currentQuestionIndex + 1;
    progressFill.style.width = ((currentQuestionIndex + 1) / questions.length * 100) + '%';
    prevBtn.disabled = currentQuestionIndex === 0;
    nextBtn.disabled = currentQuestionIndex === questions.length - 1 && !crushMode;

    applyMathJax();
}

function isChecked(idx) {
    return checkMode ? checkedQuestions[idx] : q_wasChecked(idx);
}

// В crushMode вопрос считается проверенным, если по нему уже вынесен вердикт
function q_wasChecked(idx) {
    return questions[idx]._checked === true;
}

// ===== Выбор варианта ответа =====
function selectAnswer(i) {
    // В CheckMode после проверки менять ответ нельзя
    if (checkMode && checkedQuestions[currentQuestionIndex]) return;
    if (crushMode && (crushState === 'restart' || crushState === 'advancing')) return;

    userAnswers[currentQuestionIndex] = i;

    const options = questionsContainer.querySelectorAll('.answer-option');
    options.forEach((el, idx) => {
        el.classList.toggle('selected', idx === i);
        // В CheckMode классы correct/incorrect сохраняются после проверки
        if (checkMode && checkedQuestions[currentQuestionIndex]) return;
        if (crushMode && q_wasChecked(currentQuestionIndex)) {
            // при повторном выборе до новой проверки снимаем старую разметку
            el.classList.remove('correct', 'incorrect');
        }
    });
}

// ===== Проверка ответа =====
function checkCurrentAnswer() {
    const idx = currentQuestionIndex;
    const q = questions[idx];
    const selected = userAnswers[idx];

    if (selected === null || selected === undefined) {
        if (checkMode) {
            const fb = questionsContainer.querySelector('.check-feedback');
            if (fb) fb.innerHTML = '<span style="color:#b45309; font-weight:600;">⚠ Сначала выберите вариант ответа</span>';
        }
        return false;
    }

    const isCorrect = q.answers[selected].isCorrect;
    q.isCorrect = isCorrect;

    // Подсветка вариантов
    const options = questionsContainer.querySelectorAll('.answer-option');
    options.forEach((el, i) => {
        el.classList.remove('correct', 'incorrect');
        if (crushMode) {
            // CrushMode: правильный ответ НЕ раскрываем.
            // Красным отмечаем только неверный выбор пользователя,
            // зелёным — верный вариант, который он нашёл сам
            if (isCorrect && q.answers[i].isCorrect) el.classList.add('correct');
            else if (!isCorrect && i === selected) el.classList.add('incorrect');
        } else {
            // Обычный режим / CheckMode: показываем правильный вариант
            if (q.answers[i].isCorrect) el.classList.add('correct');
            else if (i === selected) el.classList.add('incorrect');
        }
    });

    // Тексты правильных ответов сохраняем только для CheckMode
    // (там они выводятся в фидбэке). В CrushMode ответ не раскрываем.
    if (!crushMode) {
        const correctTexts = q.answers.filter(a => a.isCorrect).map(a => a.text);
        feedbackStore[idx] = { ok: isCorrect, correctTexts };
    }

    if (checkMode) {
        checkedQuestions[idx] = true;
        const fb = questionsContainer.querySelector('.check-feedback');
        if (fb) fillFeedback(fb, feedbackStore[idx]);
        const checkBtn = questionsContainer.querySelector('.check-block .btn');
        if (checkBtn) checkBtn.disabled = true;
    } else {
        questions[idx]._checked = true;
    }

    return isCorrect;
}

function fillFeedback(container, data) {
    container.innerHTML = '';
    const status = document.createElement('div');
    status.className = `status-badge ${data.ok ? 'correct' : 'incorrect'}`;
    status.textContent = data.ok ? '✓ Правильно!' : '✗ Неверно';
    container.appendChild(status);

    if (!data.ok && data.correctTexts && data.correctTexts.length > 0) {
        const line = document.createElement('div');
        line.className = 'answer-line';
        const label = document.createElement('span');
        label.className = 'answer-label';
        label.textContent = 'Правильный ответ:';
        line.appendChild(label);
        data.correctTexts.forEach(txt => line.appendChild(renderTextWithMath(txt)));
        container.appendChild(line);
    }
    applyMathJax();
}

function restoreFeedback(idx, container) {
    if (feedbackStore[idx]) fillFeedback(container, feedbackStore[idx]);
}

// ===== Навигация =====
function goToQuestion(idx) {
    if (idx < 0 || idx >= questions.length) return;
    currentQuestionIndex = idx;
    renderQuestion();
}

function handleNext() {
    if (crushMode) {
        handleNextCrush();
        return;
    }
    if (currentQuestionIndex < questions.length - 1) {
        goToQuestion(currentQuestionIndex + 1);
    }
}

// CrushMode: «Вперёд» = проверить и перейти
function handleNextCrush() {
    // После 3 ошибок — кнопка перезапускает сессию
    if (crushState === 'restart') {
        restartCrushSession();
        return;
    }
    // Идёт автоматический переход после верного ответа — игнорируем клики
    if (crushState === 'advancing') return;

    const q = questions[currentQuestionIndex];

    // Уже отвечен верно — просто идём дальше
    if (q_wasChecked(currentQuestionIndex) && q.isCorrect) {
        if (currentQuestionIndex < questions.length - 1) {
            goToQuestion(currentQuestionIndex + 1);
        } else {
            finishTest();
        }
        return;
    }

    if (userAnswers[currentQuestionIndex] === null) {
        alert('Сначала выберите вариант ответа');
        return;
    }

    const isCorrect = checkCurrentAnswer();

    if (isCorrect) {
        // Верный ответ — зелёная подсветка уже стоит, переходим дальше
        crushState = 'advancing';
        nextBtn.textContent = 'Вперёд →';
        setTimeout(() => {
            crushState = 'answering';
            if (currentQuestionIndex < questions.length - 1) {
                goToQuestion(currentQuestionIndex + 1);
            } else {
                finishTest();
            }
        }, 700);
    } else {
        crushErrors++;
        updateCrushAttemptsPill();

        if (crushErrors >= CRUSH_MAX_ERRORS) {
            crushState = 'restart';
            nextBtn.textContent = '⟲ Начать заново';
            alert(`Допущено ${CRUSH_MAX_ERRORS} ошибки. Тест начнётся заново!`);
        } else {
            // Правильный ответ не раскрываем — только сообщение об ошибке
            alert(`Неверно! Попробуйте ещё раз. Осталось попыток: ${CRUSH_MAX_ERRORS - crushErrors}`);
        }
    }
}

// Перезапуск сессии в CrushMode
function restartCrushSession() {
    crushErrors = 0;
    crushState = 'answering';
    userAnswers = new Array(questions.length).fill(null);
    checkedQuestions = new Array(questions.length).fill(false);
    feedbackStore = new Array(questions.length).fill(null);
    questions.forEach(q => { q.isCorrect = false; q._checked = false; });
    currentQuestionIndex = 0;
    nextBtn.textContent = 'Проверить →';
    updateCrushAttemptsPill();
    // Вопросы остаются в прежнем порядке (последовательность),
    // варианты ответов перемешиваются заново
    shuffleAnswers();
    renderQuestion();
}

// ===== Итоговая сводка (последний шаг) =====
function addSummaryRow(container, label, value) {
    const row = document.createElement('div');
    row.className = 'summary-row';

    const l = document.createElement('span');
    l.className = 'summary-label';
    l.textContent = label;

    const v = document.createElement('span');
    v.className = 'summary-value';
    v.textContent = value;

    row.appendChild(l);
    row.appendChild(v);
    container.appendChild(row);
    return row;
}

function renderResultsSummary(endDateTimeStr, grade) {
    resultsSummary.innerHTML = '';

    // 1. ФИО студента
    addSummaryRow(resultsSummary, 'Студент', studentName || '—');

    // 2. Дата и время окончания теста
    addSummaryRow(resultsSummary, 'Дата и время окончания теста', endDateTimeStr);

    // 3. Название темы — только если в XML есть <topicName>
    if (testTopicName) {
        addSummaryRow(resultsSummary, 'Тема', testTopicName);
    }

    // 4. Полученная оценка
    addSummaryRow(resultsSummary, 'Оценка', String(grade));

    // 5. Затраченное время
    addSummaryRow(resultsSummary, 'Затраченное время', formatTime(timeSpent));
}

// ===== Завершение теста =====
function finishTest() {
    const unanswered = userAnswers.filter(a => a === null).length;
    if (unanswered > 0 && !crushMode) {
        if (!confirm(`У вас ${unanswered} неотвеченных вопрос(ов). Завершить тест?`)) return;
    }

    // Остановка таймера
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    // Подсчёт результатов
    const total = questions.length;
    const correct = questions.filter((q, i) => {
        if (userAnswers[i] === null) return false;
        return q.answers[userAnswers[i]].isCorrect;
    }).length;
    const pct = total > 0 ? Math.round(correct / total * 100) : 0;
    const grade = pct >= 85 ? 5 : pct >= 70 ? 4 : pct >= 50 ? 3 : 2;

    // Заполнение интерфейса
    testSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');

    correctAnswersElement.textContent = correct;
    totalAnswersElement.textContent = total;
    timeSpentElement.textContent = formatTime(timeSpent);
    scoreElement.textContent = pct + '%';

    gradePill.className = 'grade-pill grade-' + grade;
    gradePill.textContent = 'Оценка: ' + grade;

    // Анимация кольца
    scoreRing.style.strokeDashoffset = 440;
    setTimeout(() => {
        scoreRing.style.strokeDashoffset = 440 - (440 * pct / 100);
    }, 100);

    // Итоговая сводка: ФИО → дата/время окончания → тема (если есть) → оценка → время
    const endDateTimeStr = new Date().toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    renderResultsSummary(endDateTimeStr, grade);

    renderDetailedResults();
    applyMathJax();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Детальные результаты: только правильно отвеченные вопросы =====
function renderDetailedResults() {
    detailedResults.innerHTML = '';

    const title = document.createElement('h3');
    title.className = 'detail-title';
    title.textContent = 'Разбор ответов';
    detailedResults.appendChild(title);

    const note = document.createElement('p');
    note.className = 'detail-note';
    note.textContent = 'Показаны только вопросы, на которые был дан правильный ответ';
    detailedResults.appendChild(note);

    // Индексы вопросов, на которые получен правильный ответ
    const correctIndexes = questions
        .map((q, i) => i)
        .filter(i => userAnswers[i] !== null && questions[i].answers[userAnswers[i]].isCorrect);

    if (correctIndexes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-note';
        empty.textContent = 'Нет вопросов, отвеченных правильно';
        detailedResults.appendChild(empty);
        return;
    }

    correctIndexes.forEach(i => {
        const q = questions[i];
        const item = document.createElement('div');
        item.className = 'detail-item';

        const status = document.createElement('div');
        status.className = 'status-badge correct';
        status.textContent = `Вопрос ${i + 1}. ✓ Верно`;
        item.appendChild(status);

        // Текст вопроса (HTML + LaTeX)
        item.appendChild(renderTextWithMath(q.text));

        // Ответ (он же правильный, т.к. вопрос отвечен верно)
        const answerLine = document.createElement('div');
        answerLine.className = 'answer-line';
        const al = document.createElement('span');
        al.className = 'answer-label';
        al.textContent = 'Ответ:';
        answerLine.appendChild(al);
        q.answers.filter(a => a.isCorrect).forEach(a => {
            answerLine.appendChild(renderTextWithMath(a.text));
        });
        item.appendChild(answerLine);

        detailedResults.appendChild(item);
    });
}

// ===== Обработчики событий =====
loadUrlBtn.addEventListener('click', handleUrlLoad);
qrCodeBtn.addEventListener('click', startQRScanner);
yandexBtn.addEventListener('click', handleYandexLoad);
demoBtn.addEventListener('click', window.loadExampleTest);
closeQrBtn.addEventListener('click', stopQRScanner);
confirmNameBtn.addEventListener('click', confirmName);

urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleUrlLoad(); });
[lastNameInput, firstNameInput, middleNameInput].forEach(inp =>
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); })
);

prevBtn.addEventListener('click', () => goToQuestion(currentQuestionIndex - 1));
nextBtn.addEventListener('click', handleNext);
finishBtn.addEventListener('click', finishTest);

restartBtn.addEventListener('click', () => startTest());
changeNameBtn.addEventListener('click', openNameOverlay);

// ===== Инициализация =====
function init() {
    // Флаги режимов из URL
    checkMode = getUrlFlag('CheckMode');
    crushMode = getUrlFlag('CrushMode');
    headerShow = getUrlFlag('HeaderShow');

    // CrushMode имеет приоритет над CheckMode
    if (checkMode && crushMode) {
        checkMode = false;
    }

    if (checkMode) checkBadge.classList.remove('hidden');
    if (crushMode) {
        crushBadge.classList.remove('hidden');
        crushAttemptsPill.classList.remove('hidden');
    }
    if (headerShow) headerBadge.classList.remove('hidden');

    // Автозагрузка теста из параметров URL
    const testUrl = getTestUrlFromLocation();
    if (testUrl) {
        urlInput.value = testUrl;
        autoLoadTest(testUrl);
    }

    // Окно ввода ФИО
    openNameOverlay();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
