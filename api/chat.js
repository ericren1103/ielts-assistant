import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

export default async function handler(req, res) {
  // 只接受POST请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, session_id, message } = req.body;
  if (!user_id || !session_id || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. 获取用户画像
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user_id)
      .single();

    // 2. 获取最近10条对话历史（按session）
    const { data: history } = await supabase
      .from('conversation_history')
      .select('role, message')
      .eq('user_id', user_id)
      .eq('session_id', session_id)
      .order('created_at', { ascending: false })
      .limit(10);

    const conversationMessages = (history || []).reverse().map(item => ({
      role: item.role,
      content: item.message
    }));

    // 3. 构造系统提示词
    const personalityInfo = profile ? `
      用户信息：
      - 姓名：${profile.name || '未知'}
      - 年龄：${profile.age || '未知'}
      - 兴趣爱好：${profile.hobbies ? profile.hobbies.join(', ') : '未知'}
      - 性格：${profile.personality || '未评估'}
    ` : '尚未建立用户画像，请在对话中自然询问用户基本信息。';

    const systemPrompt = `你是一个温柔耐心的雅思口语日常训练师，名叫侃侃。你的任务是和用户进行轻松的口语对话，鼓励他们多说，同时记录表达错误和发音问题。你已了解用户的基本信息：${personalityInfo}。在对话中要自然融入这些信息，让用户有内容可说。如果用户有语法或表达错误，用友好的方式指出并给出改进建议，然后将正确表达加入记忆库。始终保持积极鼓励的语气。

请以JSON格式返回，包含两个字段：
- "reply": 你的回复文本（可直接朗读）
- "errors": 一个数组，每个元素包含 "original"（用户原句片段）, "correction"（修正后表达）, "type"（类型：grammar/lexical/pronunciation）

如果没有错误，errors为空数组。示例：
{"reply": "Great! ...", "errors": []}`;

    // 4. 调用DeepSeek API
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationMessages,
      { role: 'user', content: message }
    ];

    const deepseekRes = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-chat',  // 使用DeepSeek模型
      messages: messages,
      temperature: 0.7,
      response_format: { type: 'json_object' }  // 要求JSON输出
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const aiResponse = deepseekRes.data.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch (e) {
      // 如果返回不是JSON，则降级为普通文本
      parsed = { reply: aiResponse, errors: [] };
    }

    // 5. 存储对话记录
    await supabase.from('conversation_history').insert([
      { user_id, session_id, role: 'user', message },
      { user_id, session_id, role: 'assistant', message: parsed.reply }
    ]);

    // 6. 如果有错误，更新user_errors表
    if (parsed.errors && parsed.errors.length > 0) {
      for (const err of parsed.errors) {
        await supabase.rpc('upsert_user_error', {
          p_user_id: user_id,
          p_error_type: err.type,
          p_original: err.original,
          p_correction: err.correction,
          p_context: message
        });  // 需要先创建存储过程，或使用upsert逻辑
        // 简单替代：先查询是否存在，存在则count+1，否则插入
      }
    }

    // 7. 返回给前端
    res.status(200).json({ reply: parsed.reply, errors: parsed.errors });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}