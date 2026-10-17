# Core polish planı (Unity öncesi)

Asset, animasyon, ses ve müzik olmadan core mechanic'leri olgunlaştırma listesi. Kıyas noktaları: Risk of
Rain 1/2 (RoR) ve Brotato. Öncelik: **P0** en önemli, **P2** sonra. ★ işaretliler ilk tespit edilenler.

Durum: 3, 4 ve 5. bölümler detaylandırıldı; diğerleri madde listesi olarak bekliyor.

## Mevcut durum özeti (kod incelemesi)

- Run'ın sonu yok: 6 harita döngüyle devam eder, `endRun` yalnızca ölümde çağrılır.
- 4 boss (`BOSS_ORDER`) 6 haritaya dağılır; hepsi aynı pattern havuzundan (nova, slam, spiral, volley,
  summon, laser, sweep, shockwave, quake, meteors) 3-6 tanesini döndürür. Faz 2 = %50 HP'de hız ve liste
  değişimi. Ölümde ek sahne yok; ödül 1 boss item'ı + altın.
- Screen shake, hit-stop, slow-mo yok.
- Karakterler yalnızca stat ve başlangıç silahıyla ayrışır; silahlar otomatik nişan alır, aktif yetenek yok.
- Level atlamak +1 max HP verir; silah tier'ı 6/14/24'te artar, 24'ten sonra level'ın oyuncu gücüne
  etkisi yok.
- Elite = ×6 HP, ×1.6 hasar; affix yok.
- Chest'ler zaten 3 item arasından seçim sunar (`ITEM_CHOICES`); yerdeki drop'lar rastgele.
- Lunar (%3) ve Void (%2) item'lar rastgele drop'la gelir, kendilerine ait bir kaynakları yok.
- Legendary drop şansı `(threat - 9.25) * 0.0013`; threat ~9.25'e (coeff ~4.8, yaklaşık 10-12. dakika)
  kadar sıfır.
- Boştaki girdiler: sol ve sağ fare tuşu, Q, R. Kullanılmayan silahlar: `smg`, `sniper`, `railgun`, `rocket`,
  `tesla`, `flamer`.

---

## 1. Run'ın sonu ★ (P0) — detaylandırılacak

- [ ] Run uzunluğunu sabitle: 5 harita + final arenası (RoR2: 5 stage + Commencement; Brotato: 20 dalga).
- [ ] Final haritası ve end boss: kendine ait arena, 3-4 fazlı boss (Mithrix'in item çalma fazı,
      Providence'ın klon çağırması).
- [ ] Kazanma ekranı: süre, kill, hasar, item bazında hasar dökümü, build özeti.
- [ ] Loop seçeneği: 5. haritadan sonra final yerine zorluğu artan döngüye devam (Primordial Teleporter).
- [ ] Zorluk seviyeleri: Drizzle/Rainstorm/Monsoon seçimi veya kazandıkça açılan Danger 0-5 (Brotato).

## 2. Boss savaşlarının tatmini ★ (P0) — detaylandırılacak

- [ ] Her bossa özgü bir mekanik (Colossus zırh fazı, Overseer laser ızgarası, Matriarch yumurtaları).
- [ ] 3 faz ve gerçek geçişler: kısa dokunulmazlık, arena değişimi, yeni saldırılar.
- [ ] Okunabilir telegraph ve saldırı sonrası punish window.
- [ ] Stagger / break barı: kısa sürede yüksek hasar → sersemleme ve ekstra hasar penceresi.
- [ ] Boss ölüm sahnesi: slow-mo, büyük patlama, mermi temizliği, ganimet yağmuru.
- [ ] Boss ödülü: 3 boss item'ından seçim veya Mountain Shrine (daha zor teleporter, daha fazla ödül).
- [ ] Geç haritalarda elite affix'li bosslar.
- [ ] Boss havuzu: harita sayısı kadar boss, haritaya 1-2 olası boss; ekstra bossların ×0.75 HP ile üst
      üste binmesinin okunabilirliğini test et.

---

## 3. Class ayrışması ★ (P0)

### Sorun

Dört karakter de aynı şekilde oynanıyor: hareket et, silah kendi ateş etsin, dash ile kaç. Farklar stat'ta:
Deadeye ile Vanguard arasında ×1.3 hasar, +%10 crit, −50 HP ve 0 armor var. `dmgMult` çarpımsal olduğu için
hasar farkı item'larla erimez. Asıl sorun, oyuncunun **yaptığı şeyin** değişmemesi: pozisyon alma, basılan
tuşlar ve kurulan build her class'ta aynı. Steak gibi düz HP item'ları ise Deadeye'ın HP açığını oransal olarak
daha hızlı kapatıyor, dolayısıyla "kırılgan" his de zamanla kayboluyor.

### Hedef: her class dört eksende ayrışsın

| Eksen | Soru |
|---|---|
| Pozisyon | Düşmana hangi mesafede durmak ödüllendiriliyor? |
| Girdi | Hangi yetenekleri, ne zaman basıyorum? |
| Build | Hangi item'lar bu class'ta daha değerli? |
| Büyüme | Level atladıkça neyim artıyor? |

Kabul kriteri: 30 saniyelik bir oynanış kaydına bakan biri class'ı tahmin edebilmeli. Ölçüm olarak da en
yakın düşmana ortalama mesafe (5. bölümdeki telemetry) class'lar arasında belirgin şekilde ayrışmalı:
Deadeye > 350, Vanguard ~250, Bulwark < 150.

### Ortak altyapı

- [ ] **Yetenek sistemi.** `CHARACTERS[].skills`: sağ tık = secondary, Q = special. Her yeteneğin cooldown'u,
      şarj sayısı ve hedefi (imleç, yön ya da kendisi) olsun. Space dash olarak kalır.
- [ ] **HUD.** Equipment slotunun yanında iki yetenek ikonu ve cooldown göstergesi.
- [ ] **Item etkileşimi.** Light Flux ve Purity yetenek cooldown'unu da etkilesin mi? Öneri: evet,
      `cdMult` ve `cdFlat` yeteneklere de uygulansın. İleride RoR'daki Alien Head benzeri bir "skill
      cooldown" item'ı eklenebilir.
- [ ] **Pasifler.** `CHARACTERS[].passive`, `recomputeStats` ve hasar hesabında okunan kural değiştiriciler.
- [ ] **Level büyümesi.** `CHARACTERS[].growth = { hp, dmgPct, armor, crit, regen, ... }`: level başına
      class'a özgü stat. Mevcut "level başına +1 HP" bunun yerine geçer.
- [ ] **Item yakınlığı.** Item'lara `tags` alanı (crit, onhit, ally, defense, movement, aoe, dash, heal)
      eklenir. Class'lar `affinity: { tag: weight }` ile loot ağırlığını değiştirir. Bu, item sheet'ine
      yeni bir `tags` sütunu demek (AGENTS.md'deki sheet akışı geçerli).
- [ ] **One-shot koruması (tüm class'lar).** RoR2 kuralı: HP %90'ın üstündeyken tek bir vuruş HP'yi %10'un
      altına indiremez. Glass cannon'un geç oyunda tek mermiyle ölmesini engeller (5. bölümdeki hesaba bak).

### Class tasarımları (başlangıç önerisi, değerler test edilecek)

#### Vanguard (Balanced): esneklik
- **Kimlik:** Her mesafede iş görür. Avantajı stat değil, seçenek.
- **Pasif, "Adaptif":** Level-up ekranında 3 yerine 4 kart görür ve map başına 1 ücretsiz reroll hakkı var.
- **Sağ tık, Frag Grenade:** İmlece bomba atar, 400% base damage, radius 120, knockback. 6s, 2 şarj.
- **Q, Suppressive Fire:** 4s boyunca +%100 attack speed ve mermilerde %10 stun şansı. 14s.
- **Büyüme:** +3 HP, +%1 hasar, +0.5 armor.
- **Yakınlık:** Yok. Dengeli havuz.

#### Deadeye (Glass Cannon): mesafe ve zamanlama
- **Kimlik:** Uzakta kal, büyük vuruşu doğru anda yap. Yaklaşırsan cezalanırsın.
- **Pasif, "Keskin Nişancı":** Hasar mesafeyle artar: 200 ve altında +%0, 500 ve üstünde +%60 (doğrusal
      artış). 150'nin içindeki hedeflere −%30 hasar. Tam HP'li düşmana ilk isabet her zaman crit.
- **Sağ tık, Charged Shot:** Basılı tut, 1.5s'de tam şarj olur. Pierce eden ışın, şarja göre
      1000%-3000% hasar. 8s. Boss burst aracı ve 2. bölümdeki stagger barıyla sinerji kurar.
- **Q, Recoil Leap:** İmlecin tersine sıçrar. Bıraktığı yerde bir flash mayını 1.5s stun uygular. 7s.
- **Stat:** HP 60, armor 0, hasar ×1.5 (×1.3'ten artış). One-shot koruması sayesinde risk adil kalır.
- **Büyüme:** +1 HP, +%1.5 hasar, +%0.5 crit.
- **Yakınlık:** crit, onhit.
- **Açık soru:** Deadeye manual nişanla gelsin mi? Manual nişanla vurulan atışlara +%20 crit bonusu
      vermek, otomatik ateşi kaldırmadan nişan almayı ödüllendirir.

#### Bulwark (Tank): kalabalığın içinde
- **Kimlik:** Düşmanın ortasına girer, vuruş yemeyi kaynağa çevirir.
- **Pasif, "Ağır Gövde":** 200 içindeki her düşman için +%5 hasar, en fazla +%50 (Deadeye'ın tam tersi).
      Dash, yoldaki düşmanları iter ve 150% base damage verir.
- **Sağ tık, Shield Wall:** 3s boyunca ön yayda mermileri bloklar, bloklanan mermiler geri yansır. 10s.
- **Q, Taunt Slam:** Radius 220 içinde 600% base damage. Düşmanlar 3s boyunca Bulwark'a kilitlenir ve
      Bulwark +50 armor alır. 12s.
- **Büyüme:** +6 HP, +1 armor, +0.1 regen.
- **Yakınlık:** defense, heal, aoe.

#### Engineer (Turrets): alan kontrolü
- **Kimlik:** Bir bölgeyi kurar ve savunur. Gücü hazırlıktan gelir, mobil değildir.
- **Pasif, "Atölye":** Kendisi ateş etmez (mevcut). Level 10 ve 20'de birer gezici taret daha kazanır,
      en fazla 4.
- **Sağ tık, Deploy Turret:** İmlece sabit bir taret kurar. 20s yaşar, en fazla 2 tane, oyuncunun item'larını
      kullanır. 15s.
- **Q, Pressure Mines:** Etrafına 4 mayın bırakır, her biri 300% base damage. 8s.
- **Büyüme:** +4 HP, taretlere +%1 attack speed.
- **Yakınlık:** ally (Spare Drone Parts, Queen's Gland, Empathy Cores ×1.5 ağırlık), aoe.

### Açık sorular
- Kullanılmayan silahlar ne olacak? Seçenekler: (a) her class 2-3 silah arasından başlangıç seçer
  (Deadeye: marksman / sniper / railgun), (b) silahlar run içinde bulunur, (c) çıkarılırlar.
- Alternatif yetenek varyantları (RoR2 skill variant'ları) şimdi mi, sonra mı? Öneri: P2.
- 5. bir class gerekli mi? Örneğin yakın dövüş / flamer kullanan bir "Pyro" ya da summoner.

### Yapılacaklar
- [ ] Yetenek altyapısı ve HUD
- [ ] Pasif ve büyüme alanları
- [ ] One-shot koruması
- [ ] Dört class'ın kit'leri
- [ ] Item `tags` + `affinity` (sheet güncellemesiyle)
- [ ] Mesafe telemetry'siyle ayrışma testi

---

## 4. Progression ve build kontrolü (P1)

### Sorun
- Level atlamak hissedilmiyor: +1 HP ve üç sabit noktada silah tier'ı. 24. level'dan sonra level'ın hiçbir
  anlamı yok.
- Chest'te seçim var ama yerdeki drop'lar, Lunar ve Void tamamen rastgele. Bir item'ı stack'lemeye
  yönelmek ya da kötü bir item'dan kurtulmak mümkün değil.

### 4.1 Level-up'ta seçim (Brotato tarzı)
- [ ] **Kart seçimi.** Her level'da 3 kart (Vanguard 4). Kartların nadirliği var: common, rare, epic,
      legendary. Nadir kart şansı level ve luck ile artar.
- [ ] **Stat havuzu ve başlangıç değerleri** (common / rare / epic):

| Stat | Common | Rare | Epic |
|---|---|---|---|
| Hasar % | +5 | +8 | +12 |
| Attack speed % | +5 | +8 | +12 |
| Max HP | +10 | +18 | +30 |
| Armor | +3 | +5 | +8 |
| Regen | +0.4 | +0.7 | +1.2 |
| Crit % | +3 | +5 | +8 |
| Hareket hızı % | +3 | +5 | +8 |
| Menzil | +25 | +40 | +60 |
| Yetenek cooldown % | −4 | −6 | −10 |
| Luck | +5 | +8 | +12 |

- [ ] **Class ağırlıkları.** Kartların çıkma sıklığı `growth` ve `affinity`'ye göre değişir: Deadeye'a daha
      çok crit ve hasar, Bulwark'a HP ve armor gelir.
- [ ] **Milestone level'lar (5, 10, 15, ...).** Normal stat kartı yerine bir yetenek modifikasyonu seçilir.
      Örnekler: Charged Shot +1 pierce, Frag Grenade +1 şarj, Shield Wall'un yansıttığı mermiler sekebilsin.
- [ ] **Zamanlama.** Level-up kartları kuyruğa girsin, HUD'da rozetle görünsün. Seçim ekranı oyuncu Tab'a
      basınca ya da teleporter tamamlanınca açılsın. Böylece kalabalık bir anda oyun durmaz.
      Açık soru: her level'da hemen açılmalı mı?
- [ ] **Level hızı hedefi.** Başta 30-45 saniyede 1 level, sonlara doğru yaklaşık dakikada 1. Final boss'a
      gelindiğinde 30-35. level. Mevcut `xpToNext = (level + 3)^2` eğrisi telemetry ile ölçülüp buna göre
      ayarlanacak.

### 4.2 Silah tier'ları
- [ ] Seçenek A: tier'ları 1/8/16/24/32'ye yay ve 5. tier ekle.
- [ ] Seçenek B: tier atlamayı milestone kartlarına bağla, yani silah tier'ı da bir seçim olsun.
- Öneri: A. Basit ve öngörülebilir. Seçimin derinliği kartlardan gelsin.

### 4.3 Build'i yönlendirme araçları
- [ ] **Chest reroll.** Chest seçim ekranında, chest fiyatının %25'iyle bir kez reroll.
- [ ] **Scrapper (her haritada %50 şansla 1 tane).** Bir item'ı aynı tier'da scrap'e çevirir. Printer'lar
      önce scrap'i kullanır.
- [ ] **3D Printer (her haritada 0-2 tane).** Tek bir item gösterir. Aynı tier'dan bir item'ı (önce scrap)
      verip o item'ı alırsın. Hangi item'ın verileceğini oyuncu seçer (RoR'da rastgele).
- [ ] **Lunar Pod (her haritada 1 tane).** Bedeli max HP'nin %25'i (blood shrine gibi). 2 Lunar item
      arasından seçim.
- [ ] **Void Cradle (3. haritadan sonra, her haritada 1 tane).** Bedeli mevcut HP'nin %50'si. Void item
      seçimi. Bu kaynaklar eklenince rastgele Lunar ve Void drop'ları kaldırılır veya yarıya düşürülür.
- [ ] **Bazaar (P2).** Teleporter'dan sonra bazen bir ara alan portalı açılsın: dükkan, reroll ve Lunar
      takası.
- [ ] **Item tooltip'inde katkı.** Item'ın run boyunca verdiği hasar ve son 30 saniyedeki DPS'i. 5.1'deki
      hasar kaynağı takibine dayanır.

### Yapılacaklar
- [ ] Level-up kart sistemi, havuz ve ağırlıklar
- [ ] Milestone yetenek modifikasyonları
- [ ] Silah tier eğrisinin uzatılması
- [ ] Chest reroll
- [ ] Scrapper ve 3D Printer
- [ ] Lunar Pod ve Void Cradle
- [ ] Item katkısını gösteren tooltip

---

## 5. End game dengesi ★ (P0-P1)

### Sorun
"End game zayıf" şu an ölçülemiyor. Elimizde yalnızca formüller var. İlk iş, dengelemenin dayanacağı
ölçüm araçları.

### 5.1 Ölçüm araçları (önce bunlar)
- [ ] **Run log.** 30 saniyede bir kayıt: süre, harita, coeff, level, tier'a göre item sayısı, teorik DPS
      (silahların `dps` toplamı), gerçek DPS (son 10 saniyede verilen hasar), EHP (max HP + shield,
      armor'la düzeltilmiş), dakikada alınan hasar, kill/dk, yaşayan düşman sayısı, altın/dk, açılan chest
      sayısı, en yakın düşmana ortalama mesafe.
- [ ] **Hasar kaynağı takibi.** Her hasar örneği bir kaynak taşısın: silah id'si ya da item id'si.
      Pause ekranında ve run sonunda tablo olarak gösterilsin.
- [ ] **Boss metrikleri.** Öldürme süresi (TTK), savaş sırasında alınan hasar, hangi pattern'den ne kadar
      hasar alındığı.
- [ ] **Dışa aktarma.** Konsoldan `exportRunLog()` çalıştırınca JSON veya CSV kopyalansın. Run'lar
      birbiriyle karşılaştırılabilsin.
- [ ] **Geç oyuna atlama.** Debug panelinde "N. haritaya / M. dakikaya git", "tier'a göre rastgele K item
      ver" ve "level ayarla". Geç oyunu test etmek için her seferinde 30 dakika oynamak gerekmesin.
- [ ] **Bot modu (P2).** Daire çizip kiting yapan basit bir yapay oyuncu. Kaba DPS ve hayatta kalma
      karşılaştırmaları için.

### 5.2 Hedef run zaman çizelgesi (ölçümle doğrulanacak hipotez)

| An | Süre | Level | Item | Legendary | Zorluk etiketi |
|---|---|---|---|---|---|
| 1. harita sonu | ~7 dk | 8-10 | 6-8 | 0 | MEDIUM / HARD |
| 3. harita sonu | ~21 dk | 18-20 | ~20 | 1-2 | VERY HARD |
| 5. harita sonu | ~35 dk | 28-30 | ~35 | 3-5 | INSANE |
| Final boss | ~40 dk | 30-35 | — | — | — |

Boss TTK hedefleri: 1-3. haritalarda 45-75s, 4-5. haritalarda 60-90s, final boss tüm fazlarıyla 2-3 dk.

### 5.3 Formüllerden çıkan risk noktaları (kontrol edilecek)
- **Düşman HP'si oyuncudan hızlı büyüyor olabilir.** 5. haritanın sonunda (~35 dk) coeff ≈
  (1 + 0.3 × 35) × 1.15⁴ ≈ 20. Bu durumda `enemyHpMult` ≈ 45 ve `enemyDmgMult` ≈ 9.2 olur. Silah tier IV
  hasarı ×3.8 ve attack speed'i ×1.35 artırıyor, yani yaklaşık ×5.1. Aradaki ×9 civarındaki farkı item'ların
  kapatması gerekiyor. 24. level'dan sonra level'ın katkısı da olmadığı için muhtemelen bir duvar oluşuyor.
  Telemetry'de "gerçek DPS / ortalama düşman HP" oranı dakikaya göre izlenecek.
- **Deadeye geç oyunda tek vuruşla ölüyor.** Aynı coeff'te Brute'un vuruşu ~110, Charger'ın lunge'ı ~99,
  Lancer ışını ~129, Colossus'un quake'i ~440 hasar (elite'ler ×1.6). Deadeye'ın HP'si 60. Bu yüzden one-shot
  koruması (3. bölüm) şart. Vanguard da boss quake'inden tek vuruşta ölüyor; telegraph'lı olduğu sürece
  RoR'da kabul edilebilir, ama 2. bölümde değerlendirilecek.
- **Legendary eğrisi geç başlıyor ve yavaş artıyor.** Threat 20'de bile drop şansı ~%1.4. Legendary chest
  ancak threat 10'dan sonra çıkıyor ve ağırlığı 0.6. Öneri: 3. haritadan itibaren her haritada garanti 1
  legendary chest, formülün başlangıcı threat ~7'ye çekilsin.
- **Düşman sınırı.** Spawn hızı threat'e göre kübik büyüyor; 700 düşman sınırına ulaşılınca zorluk yalnızca
  HP ve hasardan gelir. Geç oyunda sınıra ne kadar sürede ulaşıldığına bakılacak.
- **Enrage.** 25 saniye yaşayan düşmanlar enrage oluyor. Geç oyunda düşmanlar uzun yaşadığı için neredeyse
  hepsi enrage olabilir; telemetry'de enrage olmuş düşman oranı izlenecek.
- **Loop.** 60. dakikada 8. haritada coeff ≈ 50 ve `enemyHpMult` ≈ 197. Loop seçilirse bu eğrinin amaçlı
  olarak kontrolden çıkması istenebilir (RoR'da öyle), ama final'e kadar olan kısım kontrollü olmalı.

### 5.4 Ayarlanabilecek parametreler
`TIME_DIFFICULTY`, `MAP_DIFFICULTY`, `enemyHpMult` ve `enemyDmgMult` üsleri, `goldScale` üssü (1.55),
`WEAPON_TIER_DMG` / `WEAPON_TIER_RATE`, `rollItemTier` eşikleri, `CHESTS` ağırlıkları ve `minThreat` değerleri,
`ENRAGE_*`, `ENEMY_HP_MULT`, `SPAWN_RATE_MULT`, level kartlarının değerleri.

### Açık soru
"Zayıf" derken hangisi kastediliyor: oyuncu geç oyunda düşmanı silip geçiyor (kolay, sıkıcı) mu, yoksa bir
duvara çarpıp çaresiz kalıyor (adaletsiz) mu? Yoksa ikisinin sırayla yaşanması mı? Telemetry'den önce bir
iki run'da bu gözlemi not etmek ölçüm önceliklerini belirler.

### Yapılacaklar
- [ ] Run log ve dışa aktarma
- [ ] Hasar kaynağı takibi ve tablosu
- [ ] Boss metrikleri
- [ ] Debug: harita / dakika atlama, item verme
- [ ] Hedef zaman çizelgesine göre ilk ölçüm turu (her class ile 1 run)
- [ ] Legendary eğrisi ve garanti legendary chest
- [ ] Scaling üslerinin ölçüme göre yeniden ayarı

---

## 6. Düşman çeşitliliği (P1) — detaylandırılacak

- [ ] Elite affix'leri: Blazing (ateş izi), Overloading (kalkan, yapışan bomba), Glacial (ölünce dondurma),
      Malachite (iyileşmeyi kesme), Celestine (yakındakileri görünmez yapma). Hepsi renk ve şekille ayırt
      edilebilir olsun.
- [ ] Haritaya özgü 1-2 imza düşman.
- [ ] Mini-boss / horde dalgaları (Brotato'nun elite ve horde dalgaları).

## 7. Game feel, asset gerektirmeyenler (P1) — detaylandırılacak

- [ ] Screen shake: boss slam'i, büyük patlama, oyuncuya isabet.
- [ ] Hit-stop: crit ve elite / boss öldürüldüğünde birkaç frame.
- [ ] Hit flash, küçük knockback, ölüm "pop"u.
- [ ] Hasar sayıları: crit'te büyük, gruplama, düşük hasarı gizleme ayarı.
- [ ] Düşük HP'de kırmızı vignette, ekran dışı tehditler için ok göstergesi.
- [ ] Dash: iz efekti, görünür i-frame.

## 8. Harita ve hedefler (P2) — detaylandırılacak

- [ ] Shrine of Combat, Shrine of the Mountain, Shrine of Order, drone satın alma, kilitli kapılar.
- [ ] Teleporter event'ine ara hedefler (örneğin şarj sırasında pylon'lar).
- [ ] Harita sonu özeti.

## 9. Meta ve tekrar oynanabilirlik (P2) — detaylandırılacak

- [ ] Challenge'larla class, item ve yetenek unlock'ları.
- [ ] Artifact / modifier'lar: Command, Glass, Swarms, Sacrifice.
- [ ] Logbook: bulunan item, düşman ve boss kaydı.
