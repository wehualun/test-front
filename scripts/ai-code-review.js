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
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => { resolve(responseData); });
    });

    req.on('error', (error) => { reject(error); });
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
  const diff = execSync('git diff HEAD~1 HEAD -- . ":!package-lock.json" ":!*.lock"', {
    encoding: 'utf-8',
    maxBuffer: 5 * 1024 * 1024
  });

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
  const prompt = `请审查以下 Vue.js 项目代码变更。
变更文件：${files.join(', ')}
变更内容：
${diffContent}
请严格按照以下 JSON 格式输出审查结果，不要输出任何其他内容（包括思考过程、解释、Markdown等）：
{"passed": true/false, "feedback": "审查意见"}

通过条件：所有规范都符合。
不通过条件：违反以下任意一条规范：
1. 代码格式不正确（缩进、空格、换行）
2. 变量命名不规范（非驼峰命名）
3. 存在 console.log、debugger 等调试代码
4. 存在明显的逻辑错误或性能问题
5. Vue 组件结构不合理

请只输出 JSON，不要输出任何其他内容。`;
  const requestBody = {
    model: AI_CONFIG.model,
    messages: [
      { role: 'system', content: '你是一个严格的代码审查专家。你必须只返回 JSON 格式的结果，不要输出任何其他内容。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 500,
    stream: false,
    user: '123456'
  };

  sendHttpsRequest(
    AI_CONFIG.url,
    { Authorization: AI_CONFIG.key },
    requestBody
  ).then((response) => {
    console.log('📝 AI 原始响应:', response.slice);
    console.log('');

    let result;
    try {
      const data = JSON.parse(response);
      let content = data.choices?.[0]?.message?.content || '';
      // 如果 content 为空，尝试从 reasoning_content 中提取
      if (!content) {
        const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
        console.log('⚠️ content 为空，尝试从 reasoning_content 提取...');
        console.log('📝 reasoning_content 内容:', reasoning);
        // 尝试从 reasoning_content 中提取 JSON
        const jsonMatch = reasoning.match(/\{[\s\S]*"passed"[\s\S]*\}/);
        if (jsonMatch) {
          content = jsonMatch[0];
        } else {
          // 如果 reasoning_content 中包含通过/不通过关键词
          const lowerReasoning = reasoning.toLowerCase();
          if (lowerReasoning.includes('不通过') || lowerReasoning.includes('未通过')) {
            console.log('❌ 代码审查未通过（从推理内容判断）');
            process.exit(1);
          } else {
            console.log('✅ 代码审查通过（从推理内容判断）');
            process.exit(0);
          }
        }
      }
      if (!content) {
        console.log('⚠️ 无法获取 AI 审查结果，跳过检查');
        process.exit(0);
      }
      // 提取 JSON
      let jsonStr = content;
      if (content.includes('```json')) {
        jsonStr = content.split('```json')[1].split('```')[0];
      } else if (content.includes('```')) {
        jsonStr = content.split('```')[1].split('```')[0];
      }
      result = JSON.parse(jsonStr.trim());
    } catch (e) {
      console.log('⚠️ JSON 解析失败，尝试从响应内容判断...');
      // 从原始响应中判断
      const lowerResponse = response.toLowerCase();
      if (lowerResponse.includes('不通过') || 
          lowerResponse.includes('未通过') ||
          lowerResponse.includes('不合格')) {
        console.log('❌ 代码审查未通过！');
        console.log('📝 反馈：代码不符合规范');
        process.exit(1);
      } else {
        console.log('✅ 代码审查通过');
        process.exit(0);
      }
    }
    // 根据结果判断
    if (result.passed === true) {
      console.log('✅ 代码审查通过！');
      if (result.feedback) {
        console.log(`📝 ${result.feedback}`);
      }
      process.exit(0);
    } else if (result.passed === false) {
      console.log('❌ 代码审查未通过！');
      console.log('');
      console.log('📝 反馈意见：');
      console.log(result.feedback || '代码不符合规范');
      console.log('');
      console.log('💡 请修改代码后重新提交推送 (使用 git push --no-verify 可跳过)');
      process.exit(1);
    } else {
      console.log('✅ 代码审查通过');
      process.exit(0);
    }
  }).catch((error) => {
    console.error('❌ AI API 调用失败:', error.message);
    console.log('⚠️ 检查异常，跳过检查');
    process.exit(0);
  });

} catch (error) {
  console.error('❌ 执行错误:', error.message);
  console.log('⚠️ 检查异常，跳过检查');
  process.exit(0);
}