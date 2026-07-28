// UI の多言語辞書。キー主軸（1キー = 全言語を1ブロック）にしてあるのは、
// 文言を1つ足した時に「どの言語が空いているか」がその場で目に入るようにするため。
//
// 腐り検知: 起動時に checkMissing() が欠けているキー×言語をコンソールに列挙する。
// 実行時は t() が「選択言語 → en → キー名」の順にフォールバックするので、
// 翻訳が欠けても画面は壊れず英語が出る（無言で空文字になるのを避ける）。
//
// このファイルは main プロセス（require）と renderer（<script>）の両方から読まれる。

;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.I18N = api
})(typeof self !== 'undefined' ? self : this, function () {

  const LANGS = ['ja', 'en', 'zh', 'ko', 'es', 'pt', 'de', 'fr']

  // 言語切替メニューの表示名は常にその言語自身の表記で出す（読めない言語に迷子にならないため）
  const LANG_NAMES = {
    ja: '日本語',
    en: 'English',
    zh: '简体中文',
    ko: '한국어',
    es: 'Español',
    pt: 'Português (BR)',
    de: 'Deutsch',
    fr: 'Français',
  }

  const STRINGS = {

    // ---------- パス欄 ----------
    'tip.home': {
      ja: 'ワークスペースのルートに戻る',
      en: 'Back to the workspace root',
      zh: '返回工作区根目录',
      ko: '워크스페이스 루트로 돌아가기',
      es: 'Volver a la raíz del espacio de trabajo',
      pt: 'Voltar à raiz do workspace',
      de: 'Zurück zum Workspace-Stammverzeichnis',
      fr: 'Revenir à la racine de l’espace de travail',
    },
    'tip.up': {
      ja: '1つ上のフォルダへ',
      en: 'Go up one folder',
      zh: '上一级文件夹',
      ko: '상위 폴더로 이동',
      es: 'Subir una carpeta',
      pt: 'Subir uma pasta',
      de: 'Eine Ebene nach oben',
      fr: 'Remonter d’un dossier',
    },
    'tip.history': {
      ja: '履歴（Windowsのアドレスバー風）',
      en: 'History (like the Explorer address bar)',
      zh: '历史记录（类似资源管理器地址栏）',
      ko: '기록 (탐색기 주소 표시줄과 동일)',
      es: 'Historial (como la barra de direcciones del Explorador)',
      pt: 'Histórico (como a barra de endereços do Explorer)',
      de: 'Verlauf (wie die Explorer-Adressleiste)',
      fr: 'Historique (comme la barre d’adresse de l’Explorateur)',
    },
    'tip.go': {
      ja: 'ここを表示（Enter）',
      en: 'Browse this path (Enter)',
      zh: '打开此路径（回车）',
      ko: '이 경로 열기 (Enter)',
      es: 'Abrir esta ruta (Intro)',
      pt: 'Abrir este caminho (Enter)',
      de: 'Diesen Pfad öffnen (Enter)',
      fr: 'Ouvrir ce chemin (Entrée)',
    },
    'btn.go': {
      ja: '表示', en: 'Go', zh: '前往', ko: '이동',
      es: 'Ir', pt: 'Ir', de: 'Los', fr: 'Aller',
    },
    'ph.path': {
      ja: '表示したいフォルダのフルパスを貼って Enter（WSLパス /home/... もそのままOK）',
      en: 'Paste a full folder path and press Enter (WSL paths like /home/... work as-is)',
      zh: '粘贴文件夹完整路径并回车（WSL 路径 /home/... 可直接使用）',
      ko: '폴더의 전체 경로를 붙여넣고 Enter (WSL 경로 /home/... 도 그대로 사용 가능)',
      es: 'Pega la ruta completa de una carpeta y pulsa Intro (las rutas WSL /home/... funcionan tal cual)',
      pt: 'Cole o caminho completo de uma pasta e pressione Enter (caminhos WSL /home/... funcionam direto)',
      de: 'Vollständigen Ordnerpfad einfügen und Enter drücken (WSL-Pfade wie /home/... funktionieren direkt)',
      fr: 'Collez le chemin complet d’un dossier puis Entrée (les chemins WSL /home/... fonctionnent tels quels)',
    },
    'hist.empty': {
      ja: '履歴はまだありません',
      en: 'No history yet',
      zh: '暂无历史记录',
      ko: '기록이 아직 없습니다',
      es: 'Aún no hay historial',
      pt: 'Ainda não há histórico',
      de: 'Noch kein Verlauf',
      fr: 'Aucun historique pour l’instant',
    },
    'hist.clear': {
      ja: '履歴を消す',
      en: 'Clear history',
      zh: '清除历史记录',
      ko: '기록 지우기',
      es: 'Borrar historial',
      pt: 'Limpar histórico',
      de: 'Verlauf löschen',
      fr: 'Effacer l’historique',
    },

    // ---------- サイドバー ----------
    'tip.settings': {
      ja: '設定（文字サイズ・フォント・言語）',
      en: 'Settings (text size, font, language)',
      zh: '设置（字号、字体、语言）',
      ko: '설정 (글자 크기·글꼴·언어)',
      es: 'Ajustes (tamaño de texto, fuente, idioma)',
      pt: 'Configurações (tamanho do texto, fonte, idioma)',
      de: 'Einstellungen (Schriftgröße, Schriftart, Sprache)',
      fr: 'Réglages (taille du texte, police, langue)',
    },
    'tip.refresh': {
      ja: 'ツリー更新 (F5)',
      en: 'Refresh tree (F5)',
      zh: '刷新目录树 (F5)',
      ko: '트리 새로 고침 (F5)',
      es: 'Actualizar el árbol (F5)',
      pt: 'Atualizar a árvore (F5)',
      de: 'Baum aktualisieren (F5)',
      fr: 'Actualiser l’arborescence (F5)',
    },
    'tip.paste': {
      ja: 'クリップボードを _inbox へ (Ctrl+V)',
      en: 'Send the clipboard to _inbox (Ctrl+V)',
      zh: '将剪贴板内容放入 _inbox (Ctrl+V)',
      ko: '클립보드를 _inbox로 보내기 (Ctrl+V)',
      es: 'Enviar el portapapeles a _inbox (Ctrl+V)',
      pt: 'Enviar a área de transferência para _inbox (Ctrl+V)',
      de: 'Zwischenablage in _inbox ablegen (Strg+V)',
      fr: 'Envoyer le presse-papiers vers _inbox (Ctrl+V)',
    },
    'tip.clearFeed': {
      ja: '表示をクリア',
      en: 'Clear the list',
      zh: '清空列表',
      ko: '목록 지우기',
      es: 'Limpiar la lista',
      pt: 'Limpar a lista',
      de: 'Liste leeren',
      fr: 'Vider la liste',
    },
    'inbox.hint': {
      ja: 'ドロップ/Ctrl+Vで受領',
      en: 'Drop or Ctrl+V to receive',
      zh: '拖入或 Ctrl+V 即可接收',
      ko: '드롭 또는 Ctrl+V로 받기',
      es: 'Arrastra o pulsa Ctrl+V para recibir',
      pt: 'Arraste ou Ctrl+V para receber',
      de: 'Ablegen oder Strg+V zum Empfangen',
      fr: 'Déposez ou Ctrl+V pour recevoir',
    },
    'sidebar.footer': {
      ja: 'ファイルはドラッグで外に出せます',
      en: 'Drag any file out of the window',
      zh: '可将文件拖出窗口',
      ko: '파일을 창 밖으로 끌어낼 수 있습니다',
      es: 'Arrastra cualquier archivo fuera de la ventana',
      pt: 'Arraste qualquer arquivo para fora da janela',
      de: 'Dateien lassen sich aus dem Fenster ziehen',
      fr: 'Faites glisser un fichier hors de la fenêtre',
    },
    'tip.splitter': {
      ja: 'ドラッグで幅調整',
      en: 'Drag to resize',
      zh: '拖动调整宽度',
      ko: '드래그하여 너비 조절',
      es: 'Arrastra para ajustar el ancho',
      pt: 'Arraste para ajustar a largura',
      de: 'Zum Anpassen der Breite ziehen',
      fr: 'Glissez pour ajuster la largeur',
    },
    'tip.awayRoot': {
      ja: '{path}\n（_inbox の投入先は {inbox} のまま）',
      en: '{path}\n(files still land in {inbox})',
      zh: '{path}\n（文件仍然投入 {inbox}）',
      ko: '{path}\n(파일은 계속 {inbox}로 들어갑니다)',
      es: '{path}\n(los archivos siguen yendo a {inbox})',
      pt: '{path}\n(os arquivos continuam indo para {inbox})',
      de: '{path}\n(Dateien landen weiterhin in {inbox})',
      fr: '{path}\n(les fichiers arrivent toujours dans {inbox})',
    },
    'tip.inboxTarget': {
      ja: '投入先: {inbox}',
      en: 'Destination: {inbox}',
      zh: '投放目标：{inbox}',
      ko: '대상 위치: {inbox}',
      es: 'Destino: {inbox}',
      pt: 'Destino: {inbox}',
      de: 'Ziel: {inbox}',
      fr: 'Destination : {inbox}',
    },
    'drop.msg': {
      ja: '📥 _inbox に入れる',
      en: '📥 Drop into _inbox',
      zh: '📥 放入 _inbox',
      ko: '📥 _inbox에 넣기',
      es: '📥 Soltar en _inbox',
      pt: '📥 Soltar em _inbox',
      de: '📥 In _inbox ablegen',
      fr: '📥 Déposer dans _inbox',
    },
    'tip.feedClick': {
      ja: 'クリックでプレビュー',
      en: 'Click to preview',
      zh: '点击预览',
      ko: '클릭하여 미리 보기',
      es: 'Haz clic para previsualizar',
      pt: 'Clique para pré-visualizar',
      de: 'Zum Vorschauen klicken',
      fr: 'Cliquez pour prévisualiser',
    },

    // ---------- ウェルカム ----------
    'preview.empty': {
      ja: 'ファイルを選ぶとここに表示',
      en: 'Select a file to preview it here',
      zh: '选择文件后在此预览',
      ko: '파일을 선택하면 여기에 표시됩니다',
      es: 'Selecciona un archivo para verlo aquí',
      pt: 'Selecione um arquivo para vê-lo aqui',
      de: 'Datei auswählen, um sie hier anzuzeigen',
      fr: 'Sélectionnez un fichier pour l’afficher ici',
    },
    'welcome.tree': {
      ja: '左のツリーからファイルをクリック → プレビュー',
      en: 'Click a file in the tree on the left → preview',
      zh: '在左侧目录树中点击文件 → 预览',
      ko: '왼쪽 트리에서 파일 클릭 → 미리 보기',
      es: 'Haz clic en un archivo del árbol izquierdo → vista previa',
      pt: 'Clique num arquivo na árvore à esquerda → pré-visualização',
      de: 'Datei im Baum links anklicken → Vorschau',
      fr: 'Cliquez sur un fichier dans l’arborescence à gauche → aperçu',
    },
    'welcome.dragOut': {
      ja: 'ファイルを<b>ウィンドウの外へドラッグ</b> → Explorer やチャットに取り出し',
      en: 'Drag a file <b>out of the window</b> → drop it into Explorer or a chat app',
      zh: '将文件<b>拖出窗口</b> → 放入资源管理器或聊天应用',
      ko: '파일을 <b>창 밖으로 드래그</b> → 탐색기나 채팅 앱에 넣기',
      es: 'Arrastra un archivo <b>fuera de la ventana</b> → suéltalo en el Explorador o en un chat',
      pt: 'Arraste um arquivo <b>para fora da janela</b> → solte no Explorer ou num chat',
      de: 'Datei <b>aus dem Fenster ziehen</b> → im Explorer oder Chat ablegen',
      fr: 'Faites glisser un fichier <b>hors de la fenêtre</b> → déposez-le dans l’Explorateur ou un chat',
    },
    'welcome.dropIn': {
      ja: 'ファイルを<b>この窓にドロップ</b> → <code>_inbox/</code> に受領',
      en: 'Drop a file <b>onto this window</b> → it lands in <code>_inbox/</code>',
      zh: '将文件<b>拖入本窗口</b> → 收进 <code>_inbox/</code>',
      ko: '파일을 <b>이 창에 드롭</b> → <code>_inbox/</code>에 저장',
      es: 'Suelta un archivo <b>en esta ventana</b> → llega a <code>_inbox/</code>',
      pt: 'Solte um arquivo <b>nesta janela</b> → ele vai para <code>_inbox/</code>',
      de: 'Datei <b>in dieses Fenster ziehen</b> → sie landet in <code>_inbox/</code>',
      fr: 'Déposez un fichier <b>sur cette fenêtre</b> → il arrive dans <code>_inbox/</code>',
    },
    'welcome.dblclick': {
      ja: 'ダブルクリック → 既定のアプリで開く ／ 右クリック → メニュー',
      en: 'Double-click → open in the default app / Right-click → menu',
      zh: '双击 → 用默认应用打开 ／ 右键 → 菜单',
      ko: '더블클릭 → 기본 앱으로 열기 / 우클릭 → 메뉴',
      es: 'Doble clic → abrir en la app predeterminada / Clic derecho → menú',
      pt: 'Duplo clique → abrir no app padrão / Clique direito → menu',
      de: 'Doppelklick → in Standard-App öffnen / Rechtsklick → Menü',
      fr: 'Double-clic → ouvrir dans l’app par défaut / Clic droit → menu',
    },
    'welcome.pathbar': {
      ja: '上のパス欄にフルパスを貼って Enter → そのフォルダを表示（worktreeレーンの覗き見用）',
      en: 'Paste a full path in the bar above and press Enter → browse that folder (handy for peeking into worktree lanes)',
      zh: '在上方路径栏粘贴完整路径并回车 → 浏览该文件夹（便于查看 worktree 分支）',
      ko: '위 경로 표시줄에 전체 경로를 붙여넣고 Enter → 해당 폴더 열기 (worktree 레인 확인용)',
      es: 'Pega una ruta completa en la barra de arriba y pulsa Intro → explora esa carpeta (útil para mirar ramas worktree)',
      pt: 'Cole um caminho completo na barra acima e pressione Enter → navegue nessa pasta (útil para espiar worktrees)',
      de: 'Vollständigen Pfad oben einfügen und Enter drücken → diesen Ordner anzeigen (praktisch für Worktree-Zweige)',
      fr: 'Collez un chemin complet dans la barre du haut puis Entrée → parcourez ce dossier (pratique pour jeter un œil aux worktrees)',
    },
    'welcome.edit': {
      ja: 'プレビュー右上の<b>入力</b> → 書き込みモード（Ctrl+S で保存）',
      en: 'Press <b>Edit</b> at the top right of the preview → write mode (Ctrl+S to save)',
      zh: '点击预览右上角的<b>编辑</b> → 写入模式（Ctrl+S 保存）',
      ko: '미리 보기 오른쪽 위의 <b>편집</b> → 쓰기 모드 (Ctrl+S로 저장)',
      es: 'Pulsa <b>Editar</b> arriba a la derecha de la vista previa → modo escritura (Ctrl+S para guardar)',
      pt: 'Clique em <b>Editar</b> no topo direito da pré-visualização → modo escrita (Ctrl+S para salvar)',
      de: '<b>Bearbeiten</b> oben rechts in der Vorschau → Schreibmodus (Strg+S zum Speichern)',
      fr: 'Cliquez sur <b>Éditer</b> en haut à droite de l’aperçu → mode écriture (Ctrl+S pour enregistrer)',
    },

    // ---------- ワークスペース未設定 ----------
    'root.welcome': {
      ja: 'ようこそ。まずワークスペースフォルダを選んでください',
      en: 'Welcome. Start by choosing your workspace folder',
      zh: '欢迎。请先选择你的工作区文件夹',
      ko: '환영합니다. 먼저 워크스페이스 폴더를 선택하세요',
      es: 'Bienvenido. Empieza eligiendo tu carpeta de trabajo',
      pt: 'Bem-vindo. Comece escolhendo a pasta do seu workspace',
      de: 'Willkommen. Wählen Sie zuerst Ihren Workspace-Ordner',
      fr: 'Bienvenue. Commencez par choisir votre dossier d’espace de travail',
    },
    'root.unreachable': {
      ja: 'ワークスペースにアクセスできません',
      en: 'Cannot reach the workspace',
      zh: '无法访问该工作区',
      ko: '워크스페이스에 접근할 수 없습니다',
      es: 'No se puede acceder al espacio de trabajo',
      pt: 'Não é possível acessar o workspace',
      de: 'Auf den Workspace kann nicht zugegriffen werden',
      fr: 'Impossible d’accéder à l’espace de travail',
    },
    'root.pathNote': {
      ja: 'パス: <code>{path}</code>（WSL停止中や名前変更の可能性）',
      en: 'Path: <code>{path}</code> (WSL may be stopped, or the folder was renamed)',
      zh: '路径：<code>{path}</code>（WSL 可能已停止，或文件夹被改名）',
      ko: '경로: <code>{path}</code> (WSL이 중지되었거나 폴더 이름이 바뀌었을 수 있습니다)',
      es: 'Ruta: <code>{path}</code> (puede que WSL esté detenido o la carpeta se haya renombrado)',
      pt: 'Caminho: <code>{path}</code> (o WSL pode estar parado ou a pasta foi renomeada)',
      de: 'Pfad: <code>{path}</code> (WSL ist evtl. gestoppt oder der Ordner wurde umbenannt)',
      fr: 'Chemin : <code>{path}</code> (WSL est peut-être arrêté ou le dossier a été renommé)',
    },
    'root.hint': {
      ja: 'Claude Code で使っているフォルダを指定します。WSL内のフォルダは<br>ダイアログ左側の「Linux」から辿るか、パス欄に <code>\\\\wsl.localhost\\...</code> を貼り付けてください。',
      en: 'Pick the folder you use with Claude Code. For folders inside WSL,<br>browse via “Linux” in the dialog sidebar, or paste <code>\\\\wsl.localhost\\...</code> into the path field.',
      zh: '选择你在 Claude Code 中使用的文件夹。若在 WSL 内，<br>请通过对话框左侧的“Linux”进入，或在路径栏粘贴 <code>\\\\wsl.localhost\\...</code>。',
      ko: 'Claude Code에서 쓰는 폴더를 지정하세요. WSL 안의 폴더는<br>대화상자 왼쪽의 “Linux”에서 찾거나, 경로란에 <code>\\\\wsl.localhost\\...</code>를 붙여넣으세요.',
      es: 'Elige la carpeta que usas con Claude Code. Para carpetas dentro de WSL,<br>entra por “Linux” en el panel del diálogo o pega <code>\\\\wsl.localhost\\...</code> en el campo de ruta.',
      pt: 'Escolha a pasta que você usa com o Claude Code. Para pastas dentro do WSL,<br>navegue por “Linux” no diálogo ou cole <code>\\\\wsl.localhost\\...</code> no campo de caminho.',
      de: 'Wählen Sie den Ordner, den Sie mit Claude Code nutzen. Für Ordner innerhalb von WSL<br>über „Linux“ im Dialog navigieren oder <code>\\\\wsl.localhost\\...</code> ins Pfadfeld einfügen.',
      fr: 'Choisissez le dossier que vous utilisez avec Claude Code. Pour les dossiers dans WSL,<br>passez par « Linux » dans la boîte de dialogue ou collez <code>\\\\wsl.localhost\\...</code> dans le champ de chemin.',
    },
    'root.choose': {
      ja: '📁 フォルダを選ぶ…',
      en: '📁 Choose a folder…',
      zh: '📁 选择文件夹…',
      ko: '📁 폴더 선택…',
      es: '📁 Elegir carpeta…',
      pt: '📁 Escolher pasta…',
      de: '📁 Ordner wählen…',
      fr: '📁 Choisir un dossier…',
    },

    // ---------- プレビュー操作 ----------
    'tip.back': {
      ja: '直前のノートに戻る (Alt+←)',
      en: 'Back to the previous note (Alt+←)',
      zh: '返回上一条笔记 (Alt+←)',
      ko: '이전 노트로 돌아가기 (Alt+←)',
      es: 'Volver a la nota anterior (Alt+←)',
      pt: 'Voltar à nota anterior (Alt+←)',
      de: 'Zurück zur vorherigen Notiz (Alt+←)',
      fr: 'Revenir à la note précédente (Alt+←)',
    },
    'btn.source': {
      ja: 'ソース表示', en: 'Source', zh: '源码', ko: '소스',
      es: 'Fuente', pt: 'Fonte', de: 'Quelltext', fr: 'Source',
    },
    'btn.rendered': {
      ja: 'プレビュー表示', en: 'Preview', zh: '预览', ko: '미리 보기',
      es: 'Vista previa', pt: 'Pré-visualizar', de: 'Vorschau', fr: 'Aperçu',
    },
    'tip.undo': {
      ja: '元に戻す (Ctrl+Z)',
      en: 'Undo (Ctrl+Z)',
      zh: '撤销 (Ctrl+Z)',
      ko: '실행 취소 (Ctrl+Z)',
      es: 'Deshacer (Ctrl+Z)',
      pt: 'Desfazer (Ctrl+Z)',
      de: 'Rückgängig (Strg+Z)',
      fr: 'Annuler (Ctrl+Z)',
    },
    'tip.redo': {
      ja: 'やり直す (Ctrl+Shift+Z / Ctrl+Y)',
      en: 'Redo (Ctrl+Shift+Z / Ctrl+Y)',
      zh: '重做 (Ctrl+Shift+Z / Ctrl+Y)',
      ko: '다시 실행 (Ctrl+Shift+Z / Ctrl+Y)',
      es: 'Rehacer (Ctrl+Shift+Z / Ctrl+Y)',
      pt: 'Refazer (Ctrl+Shift+Z / Ctrl+Y)',
      de: 'Wiederherstellen (Strg+Umschalt+Z / Strg+Y)',
      fr: 'Rétablir (Ctrl+Maj+Z / Ctrl+Y)',
    },
    'btn.save': {
      ja: '保存', en: 'Save', zh: '保存', ko: '저장',
      es: 'Guardar', pt: 'Salvar', de: 'Speichern', fr: 'Enregistrer',
    },
    'btn.saved': {
      ja: '✓ 保存した', en: '✓ Saved', zh: '✓ 已保存', ko: '✓ 저장됨',
      es: '✓ Guardado', pt: '✓ Salvo', de: '✓ Gespeichert', fr: '✓ Enregistré',
    },
    'tip.save': {
      ja: 'このファイルに書き込む (Ctrl+S)',
      en: 'Write to this file (Ctrl+S)',
      zh: '写入此文件 (Ctrl+S)',
      ko: '이 파일에 쓰기 (Ctrl+S)',
      es: 'Escribir en este archivo (Ctrl+S)',
      pt: 'Gravar neste arquivo (Ctrl+S)',
      de: 'In diese Datei schreiben (Strg+S)',
      fr: 'Écrire dans ce fichier (Ctrl+S)',
    },
    'btn.edit': {
      ja: '入力', en: 'Edit', zh: '编辑', ko: '편집',
      es: 'Editar', pt: 'Editar', de: 'Bearbeiten', fr: 'Éditer',
    },
    'tip.editOn': {
      ja: '書き込みモードにする（既定は読むだけ）',
      en: 'Switch to write mode (read-only by default)',
      zh: '切换到写入模式（默认只读）',
      ko: '쓰기 모드로 전환 (기본은 읽기 전용)',
      es: 'Cambiar a modo escritura (solo lectura por defecto)',
      pt: 'Mudar para o modo escrita (somente leitura por padrão)',
      de: 'In den Schreibmodus wechseln (standardmäßig nur lesen)',
      fr: 'Passer en mode écriture (lecture seule par défaut)',
    },
    'tip.editOff': {
      ja: '入力モードを抜けてプレビューに戻る',
      en: 'Leave write mode and go back to preview',
      zh: '退出写入模式，返回预览',
      ko: '쓰기 모드를 나가고 미리 보기로 돌아가기',
      es: 'Salir del modo escritura y volver a la vista previa',
      pt: 'Sair do modo escrita e voltar à pré-visualização',
      de: 'Schreibmodus verlassen und zur Vorschau zurück',
      fr: 'Quitter le mode écriture et revenir à l’aperçu',
    },
    'tip.explorer': {
      ja: 'Explorerで表示',
      en: 'Show in Explorer',
      zh: '在资源管理器中显示',
      ko: '탐색기에서 보기',
      es: 'Mostrar en el Explorador',
      pt: 'Mostrar no Explorer',
      de: 'Im Explorer anzeigen',
      fr: 'Afficher dans l’Explorateur',
    },
    'btn.open': {
      ja: '開く', en: 'Open', zh: '打开', ko: '열기',
      es: 'Abrir', pt: 'Abrir', de: 'Öffnen', fr: 'Ouvrir',
    },
    'tip.open': {
      ja: '既定のアプリで開く',
      en: 'Open in the default app',
      zh: '用默认应用打开',
      ko: '기본 앱으로 열기',
      es: 'Abrir en la app predeterminada',
      pt: 'Abrir no app padrão',
      de: 'In der Standard-App öffnen',
      fr: 'Ouvrir dans l’app par défaut',
    },
    'btn.copy': {
      ja: 'コピー', en: 'Copy', zh: '复制', ko: '복사',
      es: 'Copiar', pt: 'Copiar', de: 'Kopieren', fr: 'Copier',
    },
    'btn.copied': {
      ja: '✓ コピーした', en: '✓ Copied', zh: '✓ 已复制', ko: '✓ 복사됨',
      es: '✓ Copiado', pt: '✓ Copiado', de: '✓ Kopiert', fr: '✓ Copié',
    },
    'tip.colGrip': {
      ja: 'ドラッグで列幅調整',
      en: 'Drag to resize the column',
      zh: '拖动调整列宽',
      ko: '드래그하여 열 너비 조절',
      es: 'Arrastra para ajustar el ancho de la columna',
      pt: 'Arraste para ajustar a largura da coluna',
      de: 'Ziehen, um die Spaltenbreite zu ändern',
      fr: 'Glissez pour ajuster la largeur de la colonne',
    },
    'preview.toolarge': {
      ja: '4MB超のためプレビュー省略。「開く」で既定アプリへ。',
      en: 'Larger than 4 MB, so the preview is skipped. Use “Open” for the default app.',
      zh: '超过 4 MB，已跳过预览。请用“打开”交给默认应用。',
      ko: '4MB를 넘어 미리 보기를 생략했습니다. “열기”로 기본 앱에서 확인하세요.',
      es: 'Supera los 4 MB, se omite la vista previa. Usa “Abrir” para la app predeterminada.',
      pt: 'Maior que 4 MB, pré-visualização ignorada. Use “Abrir” para o app padrão.',
      de: 'Größer als 4 MB, Vorschau übersprungen. Mit „Öffnen“ zur Standard-App.',
      fr: 'Plus de 4 Mo, aperçu ignoré. Utilisez « Ouvrir » pour l’app par défaut.',
    },
    'preview.unsupported': {
      ja: 'プレビュー非対応の形式です。「開く」で既定アプリへ。',
      en: 'This format has no preview. Use “Open” for the default app.',
      zh: '此格式不支持预览。请用“打开”交给默认应用。',
      ko: '미리 보기를 지원하지 않는 형식입니다. “열기”로 기본 앱에서 확인하세요.',
      es: 'Este formato no tiene vista previa. Usa “Abrir” para la app predeterminada.',
      pt: 'Este formato não tem pré-visualização. Use “Abrir” para o app padrão.',
      de: 'Für dieses Format gibt es keine Vorschau. Mit „Öffnen“ zur Standard-App.',
      fr: 'Ce format n’a pas d’aperçu. Utilisez « Ouvrir » pour l’app par défaut.',
    },
    'preview.cannotShow': {
      ja: '表示できません',
      en: 'Cannot display this file',
      zh: '无法显示',
      ko: '표시할 수 없습니다',
      es: 'No se puede mostrar',
      pt: 'Não é possível exibir',
      de: 'Kann nicht angezeigt werden',
      fr: 'Affichage impossible',
    },
    'title.editing': {
      ja: '入力中 ', en: 'Editing ', zh: '编辑中 ', ko: '편집 중 ',
      es: 'Editando ', pt: 'Editando ', de: 'Bearbeiten ', fr: 'Édition ',
    },
    'title.editingDirty': {
      ja: '● 入力中 ', en: '● Editing ', zh: '● 编辑中 ', ko: '● 편집 중 ',
      es: '● Editando ', pt: '● Editando ', de: '● Bearbeiten ', fr: '● Édition ',
    },
    'confirm.discard': {
      ja: '保存していない変更があります。破棄して進みますか？',
      en: 'You have unsaved changes. Discard them and continue?',
      zh: '有未保存的更改。要放弃并继续吗？',
      ko: '저장하지 않은 변경 사항이 있습니다. 버리고 계속할까요?',
      es: 'Hay cambios sin guardar. ¿Descartarlos y continuar?',
      pt: 'Há alterações não salvas. Descartar e continuar?',
      de: 'Es gibt ungespeicherte Änderungen. Verwerfen und fortfahren?',
      fr: 'Des modifications ne sont pas enregistrées. Les abandonner et continuer ?',
    },
    'loading': {
      ja: '読み込み中…', en: 'Loading…', zh: '加载中…', ko: '불러오는 중…',
      es: 'Cargando…', pt: 'Carregando…', de: 'Wird geladen…', fr: 'Chargement…',
    },
    'notSet': {
      ja: '(未設定)', en: '(not set)', zh: '（未设置）', ko: '(설정 안 됨)',
      es: '(sin definir)', pt: '(não definido)', de: '(nicht gesetzt)', fr: '(non défini)',
    },
    'err.read': {
      ja: '読めません: {msg}',
      en: 'Cannot read: {msg}',
      zh: '无法读取：{msg}',
      ko: '읽을 수 없습니다: {msg}',
      es: 'No se puede leer: {msg}',
      pt: 'Não foi possível ler: {msg}',
      de: 'Kann nicht gelesen werden: {msg}',
      fr: 'Lecture impossible : {msg}',
    },
    'err.save': {
      ja: '保存に失敗: {msg}',
      en: 'Save failed: {msg}',
      zh: '保存失败：{msg}',
      ko: '저장 실패: {msg}',
      es: 'Error al guardar: {msg}',
      pt: 'Falha ao salvar: {msg}',
      de: 'Speichern fehlgeschlagen: {msg}',
      fr: 'Échec de l’enregistrement : {msg}',
    },

    // ---------- 右クリックメニュー ----------
    'ctx.open': {
      ja: '既定のアプリで開く',
      en: 'Open in the default app',
      zh: '用默认应用打开',
      ko: '기본 앱으로 열기',
      es: 'Abrir en la app predeterminada',
      pt: 'Abrir no app padrão',
      de: 'In der Standard-App öffnen',
      fr: 'Ouvrir dans l’app par défaut',
    },
    'ctx.explorer': {
      ja: 'Explorerで表示',
      en: 'Show in Explorer',
      zh: '在资源管理器中显示',
      ko: '탐색기에서 보기',
      es: 'Mostrar en el Explorador',
      pt: 'Mostrar no Explorer',
      de: 'Im Explorer anzeigen',
      fr: 'Afficher dans l’Explorateur',
    },
    'ctx.copyWin': {
      ja: 'Windowsパスをコピー',
      en: 'Copy Windows path',
      zh: '复制 Windows 路径',
      ko: 'Windows 경로 복사',
      es: 'Copiar ruta de Windows',
      pt: 'Copiar caminho do Windows',
      de: 'Windows-Pfad kopieren',
      fr: 'Copier le chemin Windows',
    },
    'ctx.copyWsl': {
      ja: 'WSLパスをコピー',
      en: 'Copy WSL path',
      zh: '复制 WSL 路径',
      ko: 'WSL 경로 복사',
      es: 'Copiar ruta de WSL',
      pt: 'Copiar caminho do WSL',
      de: 'WSL-Pfad kopieren',
      fr: 'Copier le chemin WSL',
    },
    'ctx.copySelection': {
      ja: '選択をコピー',
      en: 'Copy selection',
      zh: '复制所选内容',
      ko: '선택 영역 복사',
      es: 'Copiar la selección',
      pt: 'Copiar a seleção',
      de: 'Auswahl kopieren',
      fr: 'Copier la sélection',
    },

    // ---------- 設定パネル ----------
    'set.title': {
      ja: '⚙ 設定', en: '⚙ Settings', zh: '⚙ 设置', ko: '⚙ 설정',
      es: '⚙ Ajustes', pt: '⚙ Configurações', de: '⚙ Einstellungen', fr: '⚙ Réglages',
    },
    'set.language': {
      ja: '言語 / Language', en: 'Language', zh: '语言 / Language', ko: '언어 / Language',
      es: 'Idioma / Language', pt: 'Idioma / Language', de: 'Sprache / Language', fr: 'Langue / Language',
    },
    'set.workspace': {
      ja: 'ワークスペースフォルダ',
      en: 'Workspace folder',
      zh: '工作区文件夹',
      ko: '워크스페이스 폴더',
      es: 'Carpeta del espacio de trabajo',
      pt: 'Pasta do workspace',
      de: 'Workspace-Ordner',
      fr: 'Dossier de l’espace de travail',
    },
    'set.change': {
      ja: '変更…', en: 'Change…', zh: '更改…', ko: '변경…',
      es: 'Cambiar…', pt: 'Alterar…', de: 'Ändern…', fr: 'Modifier…',
    },
    'set.fontSize': {
      ja: '文字サイズ', en: 'Text size', zh: '字号', ko: '글자 크기',
      es: 'Tamaño del texto', pt: 'Tamanho do texto', de: 'Schriftgröße', fr: 'Taille du texte',
    },
    'set.fontSizeHint': {
      ja: '（Ctrl+ホイールでも変更可）',
      en: '(Ctrl + mouse wheel also works)',
      zh: '（也可用 Ctrl+滚轮调整）',
      ko: '(Ctrl+휠로도 조절 가능)',
      es: '(también con Ctrl + rueda del ratón)',
      pt: '(também com Ctrl + roda do mouse)',
      de: '(auch mit Strg + Mausrad)',
      fr: '(également avec Ctrl + molette)',
    },
    'set.fontUi': {
      ja: 'フォント（画面全体・マークダウン表示）',
      en: 'Font (whole UI and Markdown)',
      zh: '字体（整体界面与 Markdown）',
      ko: '글꼴 (전체 화면·마크다운)',
      es: 'Fuente (toda la interfaz y Markdown)',
      pt: 'Fonte (interface toda e Markdown)',
      de: 'Schriftart (gesamte UI und Markdown)',
      fr: 'Police (interface et Markdown)',
    },
    'set.fontMono': {
      ja: 'フォント（コード・行番号・等幅）',
      en: 'Font (code, line numbers, monospace)',
      zh: '字体（代码、行号、等宽）',
      ko: '글꼴 (코드·행 번호·고정폭)',
      es: 'Fuente (código, números de línea, monoespaciada)',
      pt: 'Fonte (código, números de linha, monoespaçada)',
      de: 'Schriftart (Code, Zeilennummern, dicktengleich)',
      fr: 'Police (code, numéros de ligne, chasse fixe)',
    },
    'set.fontDefaultUi': {
      ja: '既定（Segoe UI / Yu Gothic UI）',
      en: 'Default (Segoe UI / Yu Gothic UI)',
      zh: '默认（Segoe UI / Yu Gothic UI）',
      ko: '기본 (Segoe UI / Yu Gothic UI)',
      es: 'Predeterminada (Segoe UI / Yu Gothic UI)',
      pt: 'Padrão (Segoe UI / Yu Gothic UI)',
      de: 'Standard (Segoe UI / Yu Gothic UI)',
      fr: 'Par défaut (Segoe UI / Yu Gothic UI)',
    },
    'set.fontDefaultMono': {
      ja: '既定（Consolas）',
      en: 'Default (Consolas)',
      zh: '默认（Consolas）',
      ko: '기본 (Consolas)',
      es: 'Predeterminada (Consolas)',
      pt: 'Padrão (Consolas)',
      de: 'Standard (Consolas)',
      fr: 'Par défaut (Consolas)',
    },
    'ph.fontCustom': {
      ja: 'フォント名を直接入力（選択より優先）',
      en: 'Type a font name (overrides the list)',
      zh: '直接输入字体名（优先于上方选择）',
      ko: '글꼴 이름 직접 입력 (목록보다 우선)',
      es: 'Escribe un nombre de fuente (tiene prioridad sobre la lista)',
      pt: 'Digite o nome de uma fonte (tem prioridade sobre a lista)',
      de: 'Schriftartnamen eingeben (hat Vorrang vor der Liste)',
      fr: 'Saisissez un nom de police (prioritaire sur la liste)',
    },
    'set.reset': {
      ja: '初期値に戻す', en: 'Reset to defaults', zh: '恢复默认', ko: '기본값으로 되돌리기',
      es: 'Restablecer', pt: 'Restaurar padrões', de: 'Zurücksetzen', fr: 'Réinitialiser',
    },
    'set.close': {
      ja: '閉じる', en: 'Close', zh: '关闭', ko: '닫기',
      es: 'Cerrar', pt: 'Fechar', de: 'Schließen', fr: 'Fermer',
    },

    // 日本語フォントの表示名。日本語UIでは和名、他言語ではラテン表記で出す
    'font.meiryo': {
      ja: 'メイリオ', en: 'Meiryo', zh: 'Meiryo', ko: 'Meiryo',
      es: 'Meiryo', pt: 'Meiryo', de: 'Meiryo', fr: 'Meiryo',
    },
    'font.yugothic': {
      ja: '游ゴシック', en: 'Yu Gothic', zh: 'Yu Gothic', ko: 'Yu Gothic',
      es: 'Yu Gothic', pt: 'Yu Gothic', de: 'Yu Gothic', fr: 'Yu Gothic',
    },
    'font.bizudp': {
      ja: 'BIZ UDPゴシック', en: 'BIZ UDPGothic', zh: 'BIZ UDPGothic', ko: 'BIZ UDPGothic',
      es: 'BIZ UDPGothic', pt: 'BIZ UDPGothic', de: 'BIZ UDPGothic', fr: 'BIZ UDPGothic',
    },
    'font.uddigi': {
      ja: 'UDデジタル教科書体', en: 'UD Digi Kyokasho', zh: 'UD Digi Kyokasho', ko: 'UD Digi Kyokasho',
      es: 'UD Digi Kyokasho', pt: 'UD Digi Kyokasho', de: 'UD Digi Kyokasho', fr: 'UD Digi Kyokasho',
    },
    'font.mspgothic': {
      ja: 'MS Pゴシック', en: 'MS PGothic', zh: 'MS PGothic', ko: 'MS PGothic',
      es: 'MS PGothic', pt: 'MS PGothic', de: 'MS PGothic', fr: 'MS PGothic',
    },
    'font.bizud': {
      ja: 'BIZ UDゴシック（等幅）', en: 'BIZ UDGothic (mono)', zh: 'BIZ UDGothic（等宽）', ko: 'BIZ UDGothic (고정폭)',
      es: 'BIZ UDGothic (mono)', pt: 'BIZ UDGothic (mono)', de: 'BIZ UDGothic (dicktengleich)', fr: 'BIZ UDGothic (chasse fixe)',
    },
    'font.msgothic': {
      ja: 'MSゴシック', en: 'MS Gothic', zh: 'MS Gothic', ko: 'MS Gothic',
      es: 'MS Gothic', pt: 'MS Gothic', de: 'MS Gothic', fr: 'MS Gothic',
    },

    // ---------- main プロセス側 ----------
    'main.emptyPath': {
      ja: 'パスが空です',
      en: 'The path is empty',
      zh: '路径为空',
      ko: '경로가 비어 있습니다',
      es: 'La ruta está vacía',
      pt: 'O caminho está vazio',
      de: 'Der Pfad ist leer',
      fr: 'Le chemin est vide',
    },
    'main.cannotOpen': {
      ja: '開けません: {path}',
      en: 'Cannot open: {path}',
      zh: '无法打开：{path}',
      ko: '열 수 없습니다: {path}',
      es: 'No se puede abrir: {path}',
      pt: 'Não é possível abrir: {path}',
      de: 'Kann nicht geöffnet werden: {path}',
      fr: 'Ouverture impossible : {path}',
    },
    'main.chooseTitle': {
      ja: 'ワークスペースフォルダを選択（WSL内は「Linux」から辿れます）',
      en: 'Choose your workspace folder (WSL folders are under “Linux”)',
      zh: '选择工作区文件夹（WSL 内的文件夹在“Linux”下）',
      ko: '워크스페이스 폴더 선택 (WSL 폴더는 “Linux” 아래에 있습니다)',
      es: 'Elige la carpeta del espacio de trabajo (las de WSL están en “Linux”)',
      pt: 'Escolha a pasta do workspace (as do WSL ficam em “Linux”)',
      de: 'Workspace-Ordner wählen (WSL-Ordner liegen unter „Linux“)',
      fr: 'Choisissez le dossier de l’espace de travail (ceux de WSL sont sous « Linux »)',
    },
    'main.docxFail': {
      ja: 'docx変換に失敗: {msg}',
      en: 'docx conversion failed: {msg}',
      zh: 'docx 转换失败：{msg}',
      ko: 'docx 변환 실패: {msg}',
      es: 'Error al convertir el docx: {msg}',
      pt: 'Falha na conversão do docx: {msg}',
      de: 'docx-Konvertierung fehlgeschlagen: {msg}',
      fr: 'Échec de la conversion docx : {msg}',
    },
    'main.clipEmptyName': {
      ja: '(クリップボードが空)',
      en: '(clipboard is empty)',
      zh: '（剪贴板为空）',
      ko: '(클립보드가 비어 있음)',
      es: '(portapapeles vacío)',
      pt: '(área de transferência vazia)',
      de: '(Zwischenablage ist leer)',
      fr: '(presse-papiers vide)',
    },
    'main.clipEmptyErr': {
      ja: 'ファイル/画像/テキストなし',
      en: 'no file, image, or text',
      zh: '没有文件／图片／文本',
      ko: '파일·이미지·텍스트 없음',
      es: 'sin archivo, imagen ni texto',
      pt: 'sem arquivo, imagem ou texto',
      de: 'keine Datei, kein Bild, kein Text',
      fr: 'ni fichier, ni image, ni texte',
    },
  }

  let current = 'en'

  // OS のロケールから対応言語を割り出す。zh-TW/zh-HK も今は簡体字にまとめる（要望が出たら分ける）
  function detect(locale) {
    const base = String(locale || '').toLowerCase().split(/[-_]/)[0]
    return LANGS.includes(base) ? base : 'en'
  }

  function setLang(lang) {
    current = LANGS.includes(lang) ? lang : 'en'
    return current
  }

  function getLang() { return current }

  // 選択言語 → 英語 → キー名 の順にフォールバック。翻訳漏れでも画面が空にならない。
  function t(key, vars) {
    const row = STRINGS[key]
    let s = row ? (row[current] || row.en) : undefined
    if (s === undefined) s = key
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k])
    return s
  }

  // 腐り検知: キーを足して翻訳を入れ忘れた時に、起動ログで名指しされる
  function checkMissing(log) {
    const missing = []
    for (const key of Object.keys(STRINGS)) {
      for (const lang of LANGS) {
        if (!STRINGS[key][lang]) missing.push(`${key} [${lang}]`)
      }
    }
    if (missing.length && log) log(`[i18n] 未翻訳 ${missing.length}件: ` + missing.join(', '))
    return missing
  }

  return { LANGS, LANG_NAMES, STRINGS, t, setLang, getLang, detect, checkMissing }
})
