# toio G-code Generator / Pen Plotter

toio 2 台を使ったペンプロッター用の静的 Web アプリです。

## 使い方

1. PC の Chrome または Edge で `index.html` を開きます。
2. キャンバスにフリーハンドで線画を描きます。
3. キャリブレーション値を調整します。
4. `Simulate` を実行します。
5. 移動用 toio とペン昇降用 toio を接続します。
6. シミュレーション成功後に `Run toio` を実行します。

Web Bluetooth は HTTPS または localhost 上で動作します。GitHub Pages にデプロイすると HTTPS で利用できます。

ローカル確認用に Node.js が使える場合は、依存なしで簡易サーバーを起動できます。

```bash
node scripts/serve.mjs 8000
```

## GitHub Pages

依存ライブラリやビルド手順はありません。GitHub Pages の Source をリポジトリ root に設定すれば、`index.html` がそのまま公開されます。

## 参照仕様

- [仕様ドラフト](docs/toio-plotter-spec.md)
- [toio 技術仕様](https://toio.github.io/toio-spec/)
