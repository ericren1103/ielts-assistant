import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, name, age, hobbies, personality } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id,
        name: name || null,
        age: age || null,
        hobbies: hobbies || null,
        personality: personality || null,
        updated_at: new Date()
      }, { onConflict: 'user_id' });

    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save profile' });
  }
}