import re

p = '/workspace/app.js'
src = open(p, encoding='utf-8').read()

# --- 1) Fix protectMathAngles regex: [^\s\S] (matches nothing) -> [\s\S] ---
old_regex = 'return html.replace(/(\\\\[\\(\\[]\\s\\S]*?\\\\[\\)\\]])/g, seg =>'
new_regex = 'return html.replace(/(\\\\[\\(\\[]\\s\\S]*?\\\\[\\)\\]])/g, seg =>'
assert old_regex in src, "regex not found"
src = src.replace(old_regex, new_regex)

# --- 2) Replace DOM element block with grouped els object ---
start = src.index("// ===== Элементы DOM =====")
end = src.index("// ===== Вспомогательные функции =====")
els_block = '''// =============================================================
// Ссылки на элементы DOM (сгруппированы по секциям страницы)
// =============================================================
const $ = id => document.getElementById(id);

const els = {
    // Секция загрузки теста
    uploadSection: $('uploadSection'),
    urlInput: $('urlInput'),
    loadUrlBtn: $('loadUrlBtn'),
    qrCodeBtn: $('qrCodeBtn'),
    yandexBtn: $('yandexBtn'),
    demoBtn: $('demoBtn'),
    uploadStatus: $('uploadStatus'),

    // Секция прохождения теста
    testSection: $('testSection'),
    timer: $('timer'),
    currentQuestion: $('currentQuestion'),
    totalQuestions: $('totalQuestions'),
    progressFill: $('progressFill'),
    questionsContainer: $('questionsContainer'),
    prevBtn: $('prevBtn'),
    nextBtn: $('nextBtn'),
    finishBtn: $('finishBtn'),

    // Секция результатов
    resultsSection: $('resultsSection'),
    resultsSummary: $('resultsSummary'),
    resultAvatar: $('resultAvatar'),
    resultStudentName: $('resultStudentName'),
    scoreRing: $('scoreRing'),
    score: $('score'),
    gradePill: $('gradePill'),
    correctAnswers: $('correctAnswers'),
    totalAnswers: $('totalAnswers'),
    timeSpentValue: $('timeSpent'),
    restartBtn: $('restartBtn'),
    changeNameBtn: $('changeNameBtn'),
    detailedResults: $('detailedResults'),

    // Чип студента в шапке
    studentChip: $('studentChip'),
    chipAvatar: $('chipAvatar'),
    chipName: $('chipName'),

    // Окно ввода ФИО
    welcomeOverlay: $('welcomeOverlay'),
    lastNameInput: $('lastNameInput'),
    firstNameInput: $('firstNameInput'),
    middleNameInput: $('middleNameInput'),
    nameError: $('nameError'),
    confirmNameBtn: $('confirmNameBtn'),

    // Модалка QR-сканера
    qrModal: $('qrModal'),
    qrVideo: $('qrVideo'),
    qrStatus: $('qrStatus'),
    closeQrBtn: $('closeQrBtn'),

    // Маркеры активных режимов
    checkBadge: $('checkBadge'),
    crushBadge: $('crushBadge'),
    headerBadge: $('headerBadge'),
    crushAttemptsPill: $('crushAttemptsPill'),
};

'''
src = src[:start] + els_block + src[end:]

# --- 3) Rename old element variable references to els.* (only after the els block) ---
renames = {
    'uploadSection': 'els.uploadSection',
    'urlInput': 'els.urlInput',
    'loadUrlBtn': 'els.loadUrlBtn',
    'qrCodeBtn': 'els.qrCodeBtn',
    'yandexBtn': 'els.yandexBtn',
    'demoBtn': 'els.demoBtn',
    'uploadStatus': 'els.uploadStatus',
    'testSection': 'els.testSection',
    'timerElement': 'els.timer',
    'currentQuestionElement': 'els.currentQuestion',
    'totalQuestionsElement': 'els.totalQuestions',
    'progressFill': 'els.progressFill',
    'questionsContainer': 'els.questionsContainer',
    'prevBtn': 'els.prevBtn',
    'nextBtn': 'els.nextBtn',
    'finishBtn': 'els.finishBtn',
    'resultsSection': 'els.resultsSection',
    'resultsSummary': 'els.resultsSummary',
    'resultAvatar': 'els.resultAvatar',
    'resultStudentName': 'els.resultStudentName',
    'scoreRing': 'els.scoreRing',
    'scoreElement': 'els.score',
    'gradePill': 'els.gradePill',
    'correctAnswersElement': 'els.correctAnswers',
    'totalAnswersElement': 'els.totalAnswers',
    'timeSpentElement': 'els.timeSpentValue',
    'restartBtn': 'els.restartBtn',
    'changeNameBtn': 'els.changeNameBtn',
    'detailedResults': 'els.detailedResults',
    'studentChip': 'els.studentChip',
    'chipAvatar': 'els.chipAvatar',
    'chipName': 'els.chipName',
    'welcomeOverlay': 'els.welcomeOverlay',
    'lastNameInput': 'els.lastNameInput',
    'firstNameInput': 'els.firstNameInput',
    'middleNameInput': 'els.middleNameInput',
    'nameError': 'els.nameError',
    'confirmNameBtn': 'els.confirmNameBtn',
    'qrModal': 'els.qrModal',
    'qrVideo': 'els.qrVideo',
    'qrStatus': 'els.qrStatus',
    'closeQrBtn': 'els.closeQrBtn',
    'checkBadge': 'els.checkBadge',
    'crushBadge': 'els.crushBadge',
    'headerBadge': 'els.headerBadge',
    'crushAttemptsPill': 'els.crushAttemptsPill',
}
split_marker = "crushAttemptsPill: $('crushAttemptsPill'),\n};"
head, tail = src.split(split_marker, 1)
for old, new in renames.items():
    tail = re.sub(r'(?<![\w.$])' + re.escape(old) + r'(?![\w-])', new, tail)
src = head + split_marker + tail

open(p, 'w', encoding='utf-8').write(src)
print("done")
