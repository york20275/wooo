// 產生 150 個 ✦ 平台內容帳號的種子資料：node scripts/gen-seed.mjs > seed-content-accounts.sql
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
};

const esc = (s) => s.replace(/'/g, "''");
const t0 = Date.UTC(2026, 10, 1);
const rows = [];
for (const [group, def] of Object.entries(groups)) {
  for (const [pz, pe, ptopic] of def.prefixes) {
    for (const [sz, se, sstyle] of def.suffixes) {
      const name = `${pz}${sz}`;
      const handle = `${pe}_${se}`;
      const persona = `${ptopic}；說話風格：${sstyle}`;
      rows.push(`('c_${handle}', '${esc(name)}', '${handle}', 1, '${group}', '${esc(persona)}', ${t0})`);
    }
  }
}
console.log(`-- ${rows.length} 個 ✦ 平台內容帳號`);
console.log('INSERT OR IGNORE INTO users (id, name, handle, is_content, content_group, persona, created_at) VALUES');
console.log(rows.join(',\n') + ';');
