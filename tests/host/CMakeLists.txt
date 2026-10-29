cmake_minimum_required(VERSION 3.22)
project(glok_host_test LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(GLOK_CPP ${CMAKE_CURRENT_LIST_DIR}/../../app/src/main/cpp)
set(LLAMA_SRC ${GLOK_CPP}/llama.cpp CACHE PATH "llama.cpp source (the app's submodule)")

set(LLAMA_BUILD_COMMON ON)
set(LLAMA_OPENSSL OFF)
add_subdirectory(${LLAMA_SRC} build-llama)

add_executable(engine_test engine_test.cpp ${GLOK_CPP}/glok_engine.cpp)
target_include_directories(engine_test PRIVATE ${GLOK_CPP} ${LLAMA_SRC}/common ${LLAMA_SRC}/include ${LLAMA_SRC}/ggml/include)
target_link_libraries(engine_test PRIVATE llama llama-common)
