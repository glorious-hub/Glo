plugins {
    id("com.android.application")
}

// -PglokAbis=arm64-v8a (phones) or x86_64 (the emulator test)
val glokAbis = (findProperty("glokAbis") as String? ?: "arm64-v8a").split(",").map { it.trim() }.filter { it.isNotEmpty() }
val glokVersionCode = (findProperty("glokVersionCode") as String?)?.toInt() ?: 1
val glokVersionName = findProperty("glokVersionName") as String? ?: "1.0.0"
val keystorePath: String? = System.getenv("GLOK_KEYSTORE")
val ccache = (findProperty("glokCcache") as String?) == "true"

android {
    namespace = "com.glok.app"
    compileSdk = 36
    ndkVersion = "29.0.13113456"

    defaultConfig {
        applicationId = "com.glok.app"
        minSdk = 29
        targetSdk = 34
        versionCode = glokVersionCode
        versionName = glokVersionName

        ndk {
            abiFilters += glokAbis
        }
        externalNativeBuild {
            cmake {
                // same build as llama.cpp's own Android example: every CPU variant, the best one is picked on the phone
                arguments += listOf(
                    "-DCMAKE_BUILD_TYPE=Release",
                    "-DBUILD_SHARED_LIBS=ON",
                    "-DLLAMA_BUILD_COMMON=ON",
                    "-DLLAMA_OPENSSL=OFF",
                    "-DGGML_NATIVE=OFF",
                    "-DGGML_BACKEND_DL=ON",
                    "-DGGML_CPU_ALL_VARIANTS=ON",
                    "-DGGML_LLAMAFILE=OFF",
                )
                if (ccache) {
                    arguments += listOf("-DCMAKE_C_COMPILER_LAUNCHER=ccache", "-DCMAKE_CXX_COMPILER_LAUNCHER=ccache")
                }
            }
        }
    }

    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("GLOK_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("GLOK_KEY_ALIAS")
                keyPassword = System.getenv("GLOK_KEY_PASSWORD")
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.31.6"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // the CPU variants (libggml-cpu-*.so) are found as files in the app's library folder
        jniLibs {
            useLegacyPackaging = true
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}
