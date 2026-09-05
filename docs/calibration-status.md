# キャリブレーション調整状況

## 目的

Web上の設定から計算したコマンドを実機で描画し、シミュレーションと実測の差を小さくする。最終的には、複数サンプルで共通して使えるキャリブレーション初期値を調整する。

初期値だけでは実測値に合わせにくい場合は、直線・travel・turn・円弧の計算方法を見直す。ただし、描画 geometry と timing calibration は分けて扱う。

## データの扱い

`data/` 以下のJSONは実機での計測結果・調整履歴であり、読み取り専用の基準データとして扱う。キャリブレーションの変更時は参照・比較するが、編集・上書き・整形は行わない。

サンプル側のJSONは、現在の初期値を明示するために更新できる。ただし、サンプルへ個別の `commandOverrides` を追加して実測値を再現する方法は、共通キャリブレーションの評価を隠すため使わない。

## 現在の共通初期値

| パラメータ | 値 | 対象 |
| --- | ---: | --- |
| `deadTurnMsPer90` | 1023 | turn |
| `deadMmPerSecAtDrawSpeed` | 56 | 直線 draw |
| `deadArcMmPerSecAtDrawSpeed` | 29.72 | 円弧 draw |
| `deadMmPerSecAtTravelSpeed` | 54 | pen-up travel |

## 設定値とtoioコマンドの対応

各設定値が影響するのは、対応する種類のモーターコマンドだけです。設定値を変更しても、別種類のコマンドや描画geometryは変更しません。

| 設定値 | 影響するコマンド | 計算への影響 | 影響しないもの |
| --- | --- | --- | --- |
| `deadTurnSpeed` | `turn` | turn コマンドの左右モーター速度 | turn の角度、`durationMs`、draw、travel |
| `deadTurnBalanceTrim` | `turn` | turn コマンドの左右速度差 | turn の角度、`durationMs`、draw、travel |
| `deadTurnMsPer90` | `turn` | 角度から算出する turn の `durationMs` | 左右モーター速度、draw、travel |
| `deadMmPerSecAtDrawSpeed` | 直線 `draw` の motor コマンド | 直線距離から算出する描画 `durationMs` | 円弧 draw、turn、travel、geometry |
| `deadArcMmPerSecAtDrawSpeed` | 円弧 `draw` の motor コマンド | 円弧長から算出する描画 `durationMs` | 直線 draw、turn、travel、geometry |
| `deadMmPerSecAtTravelSpeed` | `travel` の motor コマンド | pen-up 移動距離から算出する `durationMs` | draw、turn、geometry |
| `deadTravelDistanceScale` | `travel` の motor コマンド | pen-up 移動時間に掛ける距離倍率 | draw、turn、geometry |
| `drawSpeed` | 直線・円弧の draw motor コマンド | toio 左右モーターの基準速度と速度比 | turn、travel、geometry |
| `travelSpeed` | travel motor コマンド | toio 左右モーターの基準速度と速度比 | draw、turn、geometry |
| `deadWheelBaseMm` | 円弧 draw の motor コマンド | 円弧時の左右モーター速度比 | 直線 draw、turn、travel、geometry |

### コマンド種別の定義

- `turn`: toioをその場で回転させ、次の進行方向へ向けるコマンド。
- 直線 `draw`: ペンを下げた状態で直線を描くコマンド。
- 円弧 `draw`: ペンを下げた状態で円弧を描くコマンド。
- `travel`: ペンを上げた状態で次の描画開始位置へ移動するコマンド。

### 調整時の注意

- 平行線の間隔に関係する移動を調整するときは、まず `deadMmPerSecAtTravelSpeed` と `deadTravelDistanceScale` を確認する。
- turn の表示時間を調整するときは、`deadTurnMsPer90` を確認する。travel や draw の速度を変更しても turn の `durationMs` は変わらない。
- 直線 draw の時間を調整するときは `deadMmPerSecAtDrawSpeed` を使う。円弧 draw には `deadArcMmPerSecAtDrawSpeed` を使う。
- `deadMmPerSecAt...` は速度値なので、値を大きくすると同じ距離の `durationMs` は短くなり、値を小さくすると長くなる。
- `commandOverrides` に保存された個別コマンドの値は、対応する初期値より優先される場合がある。実測JSONの値を共通初期値と混同しない。

## 計測・調整状況

### 平行線

- 初期値調整後、実測の線間隔に近づいている。
- 共通初期値を評価する際の基準サンプルとする。

### 三角形

- `data/triangle-copy-paper.json` では、実測後に `commandOverrides` で調整済み。
- サンプル側には個別 `commandOverrides` を持たせず、共通初期値の影響を評価する。
- 三角形の実測値を共通初期値へ反映すると、平行線の travel・turn・draw に影響するため、差分を必ず比較する。

### 円

- 正確な実測は未実施。
- 現時点ではシミュレーションと比較的一致している。
- 円弧用の `deadArcMmPerSecAtDrawSpeed` は、直線 draw と分けて評価する。

### その他のサンプル

- 実測との差がまだ大きい。
- 直線 draw、travel、turn、円弧、geometry のどれに起因するか切り分ける必要がある。

## 評価方針

1. `data/` の実測JSONを読み取り、サンプルのgeometryとコマンド構成を対応付ける。
2. `commandOverrides` は「実測で必要だった補正」として参照し、共通初期値と区別する。
3. 初期値を1種類ずつ変更し、平行線・三角形・円・その他への `durationMs` の変化を比較する。
4. 初期値で説明できない差が残る場合だけ、計算方法の変更を検討する。
5. geometry（座標、線分の始点・終点、`penX`・`penY`）は、ユーザーが明示的に求めない限り変更しない。

## 現時点の結論

平行線は共通初期値の基準として扱える。一方、三角形の実測JSONにある個別補正値は、そのまま共通初期値へコピーできない。三角形から共通値を推定する場合は、平行線への影響を数値で併記し、共通化による副作用を確認する。
