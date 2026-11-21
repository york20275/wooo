// 產生 450 個 ✦ 平台內容帳號的種子資料（名字像一般人，主題與說話風格由下面的分組決定）：node scripts/gen-seed.mjs > seed-content-accounts.sql
const groups = {
  news: {
    prefixes: [
      ['晨間', 'morning', '每天早上整理國內重點新聞'],
      ['午後', 'noon', '中午時段的新聞重點整理'],
      ['夜貓', 'nightowl', '深夜整理今天沒看到的新聞'],
      ['城市', 'city', '城市生活與地方新聞'],
      ['生活', 'living', '民生消費、物價與生活資訊新聞'],
      ['財經', 'money', '財經與產業新聞的白話整理'],
      ['科技', 'tech', '3C 與科技產業新聞'],
      ['國際', 'world', '國際新聞的重點整理'],
      ['體育', 'sports', '運動賽事與體育新聞'],
      ['藝文', 'arts', '藝文展演與文化新聞'],
    ],
    suffixes: [
      ['時事站', 'station', '語氣穩重，像主播'],
      ['新聞筆記', 'notes', '條列重點，簡潔'],
      ['快報', 'brief', '短小精悍，一句話抓重點'],
      ['觀察室', 'lab', '喜歡補一句冷靜的觀察'],
      ['小編', 'editor', '口吻親切，像朋友聊新聞'],
    ],
  },
  game: {
    prefixes: [
      ['週末玩家', 'weekend', '週末才有空玩遊戲的上班族，分享遊玩心得'],
      ['手遊', 'mobile', '手機遊戲、抽卡與活動分享'],
      ['懷舊', 'retro', '老遊戲、童年回憶與重玩心得'],
      ['單機', 'solo', '單機大作與劇情遊戲心得'],
      ['電競', 'esports', '電競比賽與對戰遊戲話題'],
      ['獨立遊戲', 'indie', '推薦小品獨立遊戲'],
      ['桌遊', 'boardgame', '桌遊、派對遊戲與聚會玩法'],
      ['主機', 'console', '主機遊戲與新作討論'],
      ['RPG', 'rpg', '角色扮演遊戲與練功心得'],
      ['休閒', 'casual', '放鬆小遊戲與益智遊戲'],
    ],
    suffixes: [
      ['阿哲', 'zhe', '幽默自嘲'],
      ['小隊長', 'captain', '熱血，喜歡揪團'],
      ['研究室', 'lab', '喜歡分析機制與攻略'],
      ['日記', 'diary', '像在寫日記，碎碎念'],
      ['老司機', 'veteran', '資深玩家口吻，會給新手建議'],
    ],
  },
  mixed: {
    prefixes: [
      ['星座', 'stars', '每日星座小語與運勢閒聊（娛樂性質）'],
      ['塔羅', 'tarot', '塔羅牌每日一抽與心情小語（娛樂性質）'],
      ['下班', 'afterwork', '上班族下班後的生活與心情'],
      ['美食', 'foodie', '吃什麼、料理與小吃心得'],
      ['咖啡', 'coffee', '咖啡、早晨與悠閒時光'],
      ['貓咪', 'catlife', '貓奴日常與毛孩趣事'],
      ['租屋', 'renter', '租屋、小套房佈置與生活妙招'],
      ['心情', 'mood', '感情抒發、生活感悟'],
      ['旅行', 'travel', '國內小旅行、散步與景點心得'],
      ['追劇', 'binge', '追劇、電影與綜藝閒聊（不劇透）'],
    ],
    suffixes: [
      ['小語', 'words', '溫柔療癒'],
      ['日常', 'daily', '輕鬆隨性'],
      ['筆記', 'notes', '有條理，喜歡分享小技巧'],
      ['碎碎念', 'murmur', '愛吐槽但不刻薄'],
      ['研究所', 'lab', '認真又有點中二'],
    ],
  },
  fun: {
    prefixes: [
      ['上班族', 'office', '上班族的辦公室日常趣事'], ['捷運', 'mrt', '通勤搭捷運、公車遇到的趣事'], ['夜市', 'nightmarket', '逛夜市、吃小吃的趣事'],
      ['超商', 'conveni', '便利商店裡發生的大小趣事'], ['老媽', 'mom', '跟媽媽之間的爆笑日常'], ['老爸', 'dad', '爸爸的冷笑話與老派日常'],
      ['室友', 'roomie', '跟室友合租的生活趣事'], ['毛孩', 'pet', '貓狗毛孩做出的蠢萌行為'], ['健身房', 'gym', '健身房裡的尷尬與搞笑瞬間'],
      ['早餐店', 'breakfast', '早餐店阿姨與點餐趣事'], ['外送', 'delivery', '叫外送、等外送的大小事'], ['颱風天', 'typhoon', '颱風天、放假與天氣的趣事'],
      ['機車族', 'scooter', '騎機車通勤的日常趣事'], ['家族群組', 'family', '家族 LINE 群組的長輩圖與對話趣事'], ['菜市場', 'market', '逛菜市場、跟攤販殺價的趣事'],
      ['學生時代', 'school', '回憶學生時代的糗事'], ['約會', 'date', '約會與曖昧時的好笑瞬間'], ['減肥', 'diet', '減肥失敗、跟食慾奮鬥的日常'],
      ['旅遊', 'trip', '出遊、迷路與旅途中的意外趣事'], ['租屋', 'rent', '租屋、搬家與房東的趣事'],
    ],
    suffixes: [
      ['小劇場', 'theater', '像在演短劇，有對話'], ['日記', 'diary', '日記口吻，平淡中帶笑點'], ['觀察家', 'watcher', '細心觀察，冷靜吐槽'],
      ['碎碎念', 'murmur', '愛碎念但不刻薄'], ['冷笑話', 'pun', '喜歡用諧音和冷笑話收尾'], ['吐槽王', 'roast', '犀利吐槽'],
      ['大小事', 'daily', '輕鬆隨性'], ['生存記', 'survive', '把日常寫得像求生記'], ['研究所', 'lab', '一本正經地分析小事'],
      ['實錄', 'record', '像紀錄片旁白'], ['筆記', 'notes', '條列式整理'], ['阿宅', 'otaku', '有點宅、愛用網路用語'],
      ['苦主', 'victim', '總是倒楣的那個人，自嘲'], ['老司機', 'veteran', '過來人口吻'], ['隨手記', 'jot', '短短一兩句就好笑'],
    ],
  },
  // 留言專用帳號：只在 ✦ 貼文底下留言，不自己發文
  commenter: {
    prefixes: [
      ['吃瓜', 'melon', '愛看熱鬧的路人'], ['鍵盤', 'keyboard', '什麼都要回一句的鄉民'], ['夜貓', 'owl', '半夜滑手機的上班族'],
      ['學生', 'student', '下課滑社群的大學生'], ['媽媽', 'mom', '關心大家吃飽沒的媽媽'], ['工程師', 'eng', '理性但嘴很賤的工程師'],
      ['阿伯', 'uncle', '愛用長輩語氣的阿伯'], ['貓奴', 'catlover', '什麼都能扯到貓的貓奴'], ['吃貨', 'foodie', '看到什麼都想吃的吃貨'],
      ['玩家', 'gamer', '遊戲宅，常用遊戲梗'], ['追劇', 'drama', '追劇成癮，愛用劇台詞'], ['健身', 'gym', '三句不離健身的健身咖'],
      ['社畜', 'worker', '每天想下班的社畜'], ['老司機', 'driver', '很會接黃色梗、但點到為止的老司機'], ['文青', 'hipster', '講話有點文青的咖啡控'],
      ['阿宅', 'otaku', '動漫宅，愛用顏文字'], ['機車', 'scooter', '騎機車通勤的南部人'], ['理財', 'money', '什麼都扯到存錢的小資族'],
      ['旅人', 'traveler', '到處跑的背包客'], ['毛孩', 'pet', '家裡有狗的狗派'],
    ],
    suffixes: [
      ['短回', 'short', '回覆很短，常常只有幾個字'], ['笑點低', 'laugh', '很容易被逗笑，常打哈哈哈'], ['吐槽', 'roast', '愛吐槽但不惡意'],
      ['附和', 'agree', '常常附和、說同感'], ['好奇', 'curious', '常追問細節'], ['冷淡', 'cool', '語氣冷淡、一針見血'],
      ['熱情', 'warm', '很熱情、愛用驚嘆號'], ['歪樓', 'offtopic', '常常歪樓扯到別的'], ['分享', 'share', '愛分享自己的類似經驗'],
      ['表情', 'emoji', '愛用表情符號'],
    ],
  },
};


// 固定亂數種子，每次產生的結果一樣
let seed = 20261120;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const SURNAMES = [['陳','chen'],['林','lin'],['黃','huang'],['張','chang'],['李','lee'],['王','wang'],['吳','wu'],['劉','liu'],['蔡','tsai'],['楊','yang'],
  ['許','hsu'],['鄭','cheng'],['謝','hsieh'],['郭','kuo'],['洪','hung'],['曾','tseng'],['邱','chiu'],['廖','liao'],['賴','lai'],['周','chou'],
  ['徐','hsu'],['蘇','su'],['葉','yeh'],['莊','chuang'],['呂','lu'],['江','chiang'],['何','ho'],['蕭','hsiao'],['羅','lo'],['高','kao']];
const GIVEN = [['怡','yi'],['君','chun'],['婷','ting'],['雅','ya'],['筑','chu'],['宜','yi'],['庭','ting'],['佳','chia'],['欣','hsin'],['涵','han'],
  ['萱','hsuan'],['瑜','yu'],['芸','yun'],['詩','shih'],['彤','tung'],['家','chia'],['豪','hao'],['冠','kuan'],['宇','yu'],['承','cheng'],
  ['翰','han'],['柏','po'],['宏','hung'],['俊','chun'],['傑','chieh'],['志','chih'],['明','ming'],['哲','che'],['偉','wei'],['育','yu'],
  ['安','an'],['睿','jui'],['品','pin'],['妤','yu'],['晴','ching'],['軒','hsuan'],['廷','ting'],['恩','en'],['郁','yu'],['凱','kai']];
const NICK = ['阿凱','阿哲','阿宏','阿傑','阿明','阿翔','阿豪','阿偉','小雨','小晴','小魚','小安','小葉','小米','小恩','小琪','婷婷','芸芸','佳佳','欣欣','萱萱','瑜瑜','彤彤','恩恩',
  '胖虎不胖','貓奴阿敏','台中小許','高雄阿鴻','新竹工程獅','板橋王小姐','三重李先生','台南吃貨','花蓮女孩','宜蘭阿伯的孫子','桃園通勤族','基隆雨人'];
const NICK_EN = ['ahkai','ahche','ahhung','ahchieh','ahming','ahhsiang','ahhao','ahwei','xiaoyu','xiaoqing','xiaofish','xiaoan','xiaoyeh','xiaomi','xiaoen','xiaochi','tingting','yunyun','chiachia','hsinhsin','hsuanhsuan','yuyu','tungtung','enen',
  'notfat_tiger','catslave_min','taichung_hsu','kaohsiung_hung','hsinchu_eng','banqiao_ms_wang','sanchong_lee','tainan_foodie','hualien_girl','yilan_grandson','taoyuan_commuter','keelung_rainman'];
const EN = ['Kevin','Amy','Jerry','Vivian','Eric','Joanne','Andy','Cindy','Jason','Tina','Allen','Grace','Ryan','Iris','Leo','Nina','Ken','Peggy','Sam','Wendy','Chris','Ivy','Tony','Mia','Jack','Sandy','Ben','Emma','Max','Rita'];

const used = new Set(); const usedHandles = new Set();
function makeName() {
  for (;;) {
    const r = rand(); let name, handle;
    const [sz, se] = pick(SURNAMES);
    if (r < 0.45) { const [g1, e1] = pick(GIVEN); const [g2, e2] = pick(GIVEN); if (g1 === g2) continue; name = sz + g1 + g2; handle = `${e1}${e2}.${se}`; }
    else if (r < 0.6) { const i = Math.floor(rand() * NICK.length); name = NICK[i]; handle = NICK_EN[i]; }
    else if (r < 0.8) { const en = pick(EN); name = rand() < 0.5 ? `${en} ${sz}` : `${en} ${se[0].toUpperCase()}${se.slice(1)}`; handle = `${en.toLowerCase()}_${se}`; }
    else { const [g1, e1] = pick(GIVEN); const [g2, e2] = pick(GIVEN); if (g1 === g2) continue; name = `${e1}${e2}${pick(['', '_', '.'])}${String(Math.floor(rand() * 9000) + 100)}`; handle = name.replace(/[^a-z0-9_.]/g, ''); }
    if (used.has(name)) continue;
    let h = handle, n = 2; while (usedHandles.has(h)) h = `${handle}${n++}`;
    used.add(name); usedHandles.add(h); return [name, h];
  }
}

const esc = (s) => s.replace(/'/g, "''");
const t0 = Date.UTC(2026, 10, 1);
const rows = [];
for (const [group, def] of Object.entries(groups)) {
  const combos = [];
  for (const [, , ptopic] of def.prefixes) for (const [, , sstyle] of def.suffixes) combos.push(`${ptopic}；說話風格：${sstyle}`);
  for (const persona of shuffle(combos)) {
    const [name, handle] = makeName();
    const id = 'c_' + handle.replace(/\./g, '_');
    rows.push(`('${id}', '${esc(name)}', '${handle}', 1, '${group}', '${esc(persona)}', ${t0 + Math.floor(rand() * 20 * 86400_000)})`);
  }
}
console.log(`-- ${rows.length} 個 ✦ 平台內容帳號`);
console.log('INSERT OR IGNORE INTO users (id, name, handle, is_content, content_group, persona, created_at) VALUES');
console.log(rows.join(',\n') + ';');
