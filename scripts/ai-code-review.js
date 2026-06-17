// scripts/ai-code-review.js
const { execSync } = require('child_process');
const https = require('https');
const url = require('url');

// =============================================
// 讯飞星火 API 配置
// =============================================
const AI_CONFIG = {
  url: 'https://spark-api-open.xf-yun.com/agent/v1/chat/completions',
  key: 'Bearer kvxDKcPHCxRXeVJQyKBU:pgLgQpmfczgoTIqwzoot',
  model: 'spark-x'
};
// =============================================

// 发送 HTTPS 请求的函数
function sendHttpsRequest(apiUrl, headers, data) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(apiUrl);
    const postData = JSON.stringify(data);

    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': headers.Authorization || '',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        resolve(responseData);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

console.log('');
console.log('╔════════════════════════════════════════╗');
console.log('║   🔍 AI 代码规范检查中...              ║');
console.log('╚════════════════════════════════════════╝');
console.log('');

try {
  // 获取本次推送的变更内容
  const diff = execSync('git diff HEAD~1 HEAD -- . ":!package-lock.json" ":!*.lock"', {
    encoding: 'utf-8',
    maxBuffer: 5 * 1024 * 1024
  });

  // 获取变更文件列表
  const files = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf-8' })
    .split('\n')
    .filter(f => f && !f.includes('package-lock.json') && !f.includes('.lock'));

  if (files.length === 0 || !diff.trim()) {
    console.log('✅ 没有代码变更需要检查');
    process.exit(0);
  }

  console.log(`📁 检测到 ${files.length} 个文件变更`);
  files.forEach(f => console.log(`   - ${f}`));
  console.log('');

  // 如果是纯配置文件变更，跳过检查
  const isConfigOnly = files.every(f =>
    f.includes('package.json') ||
    f.includes('vue.config.js') ||
    f.includes('.json') ||
    f.includes('.lock')
  );

  if (isConfigOnly) {
    console.log('✅ 仅配置文件变更，跳过代码检查');
    process.exit(0);
  }

  const diffContent = diff.slice(0, 8000);
  console.log('📤 正在调用讯飞星火 AI 代码审查...');
  console.log('');

  // 构建审查 Prompt
  const prompt = `你是一个代码审查专家，请检查以下 Vue.js 项目代码变更是否符合规范：

审查标准：
1. 代码格式是否正确（缩进、空格、换行）
2. 变量命名是否规范（驼峰命名法）
3. 是否有 console.log、debugger 等调试代码残留
4. 是否有明显的逻辑错误或性能问题
5. Vue 组件结构是否合理

变更文件：
${files.join('\n')}

变更内容：
${diffContent}

请只返回 JSON 格式结果：
{"passed": true/false, "feedback": "具体改进建议（中文）"}`;

  // 构建请求体
  const requestBody = {
    model: AI_CONFIG.model,
    messages: [
      { role: 'system', content: '你是一个代码审查专家，只返回 JSON 格式结果。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 500,
    stream: false,
    user: '123456'
  };

  // 使用 HTTPS 发送请求（不依赖 curl）
  sendHttpsRequest(
    AI_CONFIG.url,
    { Authorization: AI_CONFIG.key },
    requestBody
  ).then((response) => {
    // 解析 AI 返回结果
    let result;
    try {
      const data = JSON.parse(response);
      const content = data.choices?.[0]?.message?.content || '';

      let jsonStr = content;
      if (content.includes('```json')) {
        jsonStr = content.split('```json')[1].split('```')[0];
      } else if (content.includes('```')) {
        jsonStr = content.split('```')[1].split('```')[0];
      }

      result = JSON.parse(jsonStr.trim());
    } catch (e) {
      console.log('⚠️ AI 响应解析失败，跳过检查');
      console.log('📝 原始响应:', response.slice(0, 500));
      process.exit(0);
    }

    // 输出检查结果
    if (result.passed) {
      console.log('✅ AI 代码审查通过！');
      if (result.feedback) {
        console.log(`📝 ${result.feedback}`);
      }
      process.exit(0);
    } else {
      console.log('❌ AI 代码审查未通过！');
      console.log('');
      console.log('📝 反馈意见：');
      console.log(result.feedback || '无详细反馈');
      console.log('');
      console.log('💡 请根据反馈修改代码后，重新提交推送。');
      console.log('   （如需跳过检查，可使用: git push --no-verify）');
      process.exit(1);
    }
  }).catch((error) => {
    console.error('❌ AI API 调用失败:', error.message);
    console.log('⚠️ 检查发生异常，跳过检查以保证推送继续进行');
    process.exit(0);
  });

} catch (error) {
  console.error('❌ 执行错误:', error.message);
  console.log('⚠️ 检查发生异常，跳过检查以保证推送继续进行');
  process.exit(0);
}