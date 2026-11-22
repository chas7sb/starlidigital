<script lang="ts">
 export let compact = false;
</script>

<section class="chat-welcome" class:compact aria-labelledby="chat-welcome-title">
 <img class="starli-mark" src="/static/starlidigital-mark.svg" alt="" width="44" height="44"/>
 <h1 id="chat-welcome-title">What should we work on?</h1>
 <slot />
</section>

<style>
 .starli-mark{display:block;margin:0 auto 16px;width:44px;height:44px}
 .chat-welcome { width: 100%; margin: auto; padding: 32px 0; color: var(--sd-text, inherit); }
 h1 { margin: 0 12px 32px; text-align: center; font-size: clamp(22px, 2vw, 25px); font-weight: 500; line-height: 1.25; letter-spacing: -.025em; }
 .compact { padding-block: 24px; }
 @media (max-width: 600px) { h1 { margin-bottom: 24px; } }
</style>
