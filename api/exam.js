import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  try {
    // 获取用户最近10条发言（仅user角色）
    const { data: userMessages } = await supabase
      .from('conversation_history')
      .select('message')
      .eq('user_id', user_id)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(10);

    const transcript = (userMessages || []).map(m => m.message).join('\n');

    const systemPrompt = `你是一个严格的雅思考官。请根据雅思口语评分标准，对以下考生发言进行评分。评分维度：流利度（Fluency）、词汇（Lexical）、语法（Grammar），每个维度1-9分。同时给出总体评语和三条改进建议。请以JSON格式返回，包含字段：fluency, lexical, grammar, comment, suggestions（数组）。考生发言：\n${transcript}`;

    const deepseekRes = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: systemPrompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const result = JSON.parse(deepseekRes.data.choices[0].message.content);
    // 存储报告
    await supabase.from('assessment_reports').insert({
      user_id,
      fluency: result.fluency,
      lexical: result.lexical,
      grammar: result.grammar,
      comment: result.comment,
      suggestions: result.suggestions
    });

    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
}