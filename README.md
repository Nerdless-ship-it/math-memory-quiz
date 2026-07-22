# 速算训练

一个无需安装的网页速算测试应用，包含两个专项：

- 百分数与分数：30 对双向随机换算
- 平方与幂次：24 对平方数、立方数和四次幂双向测试

每轮测试会随机覆盖全部题目，并在交卷后给出正确率、总用时和错题订正。

## 本地运行

```powershell
npm start
```

打开 `http://127.0.0.1:4173`。

## 测试

```powershell
npm test
npm run test:browser
npm run test:powers-browser
```

## Cloudflare 部署

`public` 是完整的静态网站文件夹，入口文件是 `public/index.html`。不要只上传
`index.html`，它需要同目录中的 CSS、图标以及 `public/js` 下的脚本。

使用 Cloudflare Workers Builds 连接本仓库时：

- 根目录保持仓库根目录（留空或 `/`）
- 部署命令填写 `npm run deploy:cloudflare`
- 不需要填写额外的构建输出目录，`wrangler.jsonc` 已指定 `./public`

部署前可运行：

```powershell
npm run check:cloudflare
```

如果使用 Cloudflare Pages 的直接上传功能，请选择整个 `public` 文件夹；该文件夹
打开后第一层就能看到 `index.html`。
