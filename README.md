# Daily Quest Board

一個把每日待辦事項做成遊戲任務板的網頁 app。支援月曆檢視、點選日期規畫任務、每日簽到、每日任務、連續簽到，並可接 Firebase Firestore 雲端同步。

## 使用方式

1. 開啟 `index.html`，或用本機伺服器瀏覽。
2. 在月曆中點選日期，即可新增或管理該日任務。
3. 點右上角設定按鈕。
4. 貼上 Firebase Web App 的 config JSON。
5. Firestore 建議啟用 Anonymous Auth，資料會寫入 `users/{uid}/days/{yyyy-mm-dd}`。

未貼 Firebase 設定時，app 會使用瀏覽器 localStorage 作為示範模式。

本機伺服器：

```bash
node dev-server.js
```

## Firebase 規則範例

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
