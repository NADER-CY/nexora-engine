/* Authorized reproducible metadata input; compile locally, do not run it. */
#if defined(_WIN32)
__declspec(dllexport)
#endif
int nexora_example(int value) { return value + 1; }
int main(void) { return nexora_example(0); }
