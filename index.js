const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    // 1. 彻底处理预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 2. 核心对话接口
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const { question, student_id, model_config, language, grade, subject } = body;

        // 根据前端配置动态选择模型
        const modelId = model_config?.model || "@cf/meta/llama-3.1-8b-instruct";
        
        const systemPrompt = `你是一位苏格拉底式导师。学生等级: ${grade}, 科目: ${subject}。
        任务: 引导学生思考问题 "${question}"。
        规则: 1. 绝对严禁直接给出答案。 2. 使用${language === 'en' ? '英文' : '中文'}。 
        3. 针对${grade}学生的认知水平进行逻辑拆解。`;

        let aiRes;
        let model_status = "● 模型正常";
        try {
          // 尝试调用AI模型
          aiRes = await env.AI.run(modelId, { prompt: systemPrompt });
        } catch (aiError) {
          // 详细记录AI模型调用错误
          console.error(`Model ${modelId} error:`, aiError);
          model_status = "● 模型异常";
          
          // 返回一个友好的错误响应
          return new Response(JSON.stringify({
            error: `模型 ${modelId} 加载失败，请检查配置`,
            model_status: model_status,
            details: aiError.message
          }), { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        // 统一字段名，防止前端出现 undefined
        const output = {
          guide_message: aiRes.response || aiRes.answer || "导师正在整理逻辑，请稍后...",
          thinking: aiRes.thinking || "AI 正在深度检索知识库并生成逻辑链...",
          db_status: "● 存储成功",
          vec_status: "● 索引活跃",
          model_status: model_status
        };

        // 写入 D1
        try {
          await env.DB.prepare(
            "INSERT INTO study_sessions (student_id, grade, subject, question, response, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
          ).bind(student_id, grade, subject, question, output.guide_message, new Date().toISOString()).run();
        } catch(dbE) { console.error("D1 Error"); }

        return new Response(JSON.stringify(output), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 3. 学习报表接口
    if (url.pathname === "/api/report" && request.method === "GET") {
      const sid = url.searchParams.get("sid");
      const results = await env.DB.prepare("SELECT subject, COUNT(*) as count FROM study_sessions WHERE student_id = ? GROUP BY subject").bind(sid).all();
      return new Response(JSON.stringify(results.results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response("Service Online", { headers: corsHeaders });
  }
};